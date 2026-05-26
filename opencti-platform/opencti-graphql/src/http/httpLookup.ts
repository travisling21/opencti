import type Express from 'express';
import { basePath, logApp } from '../config/conf';
import { createAuthenticatedContext } from './httpAuthenticatedContext';
import { getClientBase } from '../database/redis';

const CACHE_TTL = 86400; // 24 hours
const CACHE_PREFIX = 'opencti:lookup:';

const cachedLookup = async (cacheKey: string, fetchFn: () => Promise<any>): Promise<{ data: any; cached: boolean }> => {
  const cached = await getClientBase().get(cacheKey);
  if (cached) {
    return { data: JSON.parse(cached), cached: true };
  }
  const data = await fetchFn();
  await getClientBase().set(cacheKey, JSON.stringify(data), 'EX', CACHE_TTL);
  return { data, cached: false };
};

const lookupIp = async (ip: string, abuseipdbKey?: string) => {
  const results: any = { ip, sources: [] };

  if (abuseipdbKey) {
    try {
      const res = await fetch(`https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90&verbose`, {
        headers: { Key: abuseipdbKey, Accept: 'application/json' },
      });
      if (res.ok) {
        const json = await res.json();
        const d = json.data;
        results.sources.push({
          source: 'AbuseIPDB',
          abuse_confidence_score: d.abuseConfidenceScore,
          total_reports: d.totalReports,
          country_code: d.countryCode,
          isp: d.isp,
          domain: d.domain,
          is_tor: d.isTor,
          is_whitelisted: d.isWhitelisted,
          last_reported_at: d.lastReportedAt,
          usage_type: d.usageType,
        });
      }
    } catch (err) {
      logApp.debug('[LOOKUP] AbuseIPDB error', { cause: err });
    }
  }

  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
    if (res.ok) {
      const geo = await res.json();
      if (!geo.error) {
        results.sources.push({
          source: 'IP Geolocation',
          country: geo.country_name,
          country_code: geo.country_code,
          region: geo.region,
          city: geo.city,
          org: geo.org,
          asn: geo.asn,
          timezone: geo.timezone,
        });
      }
    }
  } catch (err) {
    logApp.debug('[LOOKUP] IP geolocation error', { cause: err });
  }

  return results;
};

const lookupDomain = async (domain: string) => {
  const results: any = { domain, sources: [] };

  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`);
    if (res.ok) {
      const dns = await res.json();
      results.sources.push({
        source: 'Google DNS',
        status: dns.Status === 0 ? 'NOERROR' : `ERROR (${dns.Status})`,
        answers: (dns.Answer || []).map((a: any) => ({
          type: a.type === 1 ? 'A' : a.type === 28 ? 'AAAA' : a.type === 5 ? 'CNAME' : `Type ${a.type}`,
          value: a.data,
          ttl: a.TTL,
        })),
      });
    }
  } catch (err) {
    logApp.debug('[LOOKUP] DNS error', { cause: err });
  }

  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`);
    if (res.ok) {
      const dns = await res.json();
      if (dns.Answer && dns.Answer.length > 0) {
        results.sources.push({
          source: 'MX Records',
          records: dns.Answer.map((a: any) => a.data),
        });
      }
    }
  } catch (err) {
    logApp.debug('[LOOKUP] MX error', { cause: err });
  }

  return results;
};

const lookupHash = async (hash: string) => {
  const results: any = { hash, hash_type: 'unknown', sources: [] };

  if (hash.length === 32) results.hash_type = 'MD5';
  else if (hash.length === 40) results.hash_type = 'SHA-1';
  else if (hash.length === 64) results.hash_type = 'SHA-256';

  try {
    const res = await fetch(`https://mb-api.abuse.ch/api/v1/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `query=get_info&hash=${encodeURIComponent(hash)}`,
    });
    if (res.ok) {
      const json = await res.json();
      if (json.query_status === 'ok' && json.data && json.data.length > 0) {
        const d = json.data[0];
        results.sources.push({
          source: 'MalwareBazaar',
          file_name: d.file_name,
          file_type: d.file_type,
          file_size: d.file_size,
          signature: d.signature,
          first_seen: d.first_seen,
          last_seen: d.last_seen,
          tags: d.tags,
          intelligence: d.intelligence,
        });
      }
    }
  } catch (err) {
    logApp.debug('[LOOKUP] MalwareBazaar error', { cause: err });
  }

  return results;
};

const lookupCve = async (cve: string) => {
  const results: any = { cve, sources: [] };

  try {
    const res = await fetch(`https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(cve)}`);
    if (res.ok) {
      const json = await res.json();
      const vuln = json.vulnerabilities?.[0]?.cve;
      if (vuln) {
        const desc = vuln.descriptions?.find((d: any) => d.lang === 'en')?.value || '';
        const cvssV31 = vuln.metrics?.cvssMetricV31?.[0]?.cvssData;
        const cvssV2 = vuln.metrics?.cvssMetricV2?.[0]?.cvssData;
        const cvss = cvssV31 || cvssV2;
        results.sources.push({
          source: 'NVD',
          description: desc,
          published: vuln.published,
          last_modified: vuln.lastModified,
          cvss_version: cvssV31 ? '3.1' : cvssV2 ? '2.0' : null,
          cvss_score: cvss?.baseScore || null,
          cvss_severity: cvssV31?.baseSeverity || null,
          cvss_vector: cvss?.vectorString || null,
          references: (vuln.references || []).slice(0, 5).map((r: any) => ({
            url: r.url,
            source: r.source,
          })),
          weaknesses: (vuln.weaknesses || []).map((w: any) => w.description?.[0]?.value).filter(Boolean),
        });
      }
    }
  } catch (err) {
    logApp.debug('[LOOKUP] NVD error', { cause: err });
  }

  return results;
};

const initHttpLookup = (app: Express.Application) => {
  app.get(`${basePath}/lookup/ip/:value`, async (req: Express.Request, res: Express.Response) => {
    try {
      const context = await createAuthenticatedContext(req, res, 'lookup');
      if (!context.user) { res.sendStatus(403); return; }
      const { value } = req.params;
      const cacheKey = `${CACHE_PREFIX}ip:${value}`;
      const abuseipdbKey = req.query.abuseipdb_key as string || undefined;
      const result = await cachedLookup(cacheKey, () => lookupIp(value, abuseipdbKey));
      res.json({ ...result.data, cached: result.cached, looked_up_at: new Date().toISOString() });
    } catch (e: any) {
      logApp.error('[LOOKUP] IP lookup error', { cause: e });
      res.status(500).json({ error: e.message });
    }
  });

  app.get(`${basePath}/lookup/domain/:value`, async (req: Express.Request, res: Express.Response) => {
    try {
      const context = await createAuthenticatedContext(req, res, 'lookup');
      if (!context.user) { res.sendStatus(403); return; }
      const { value } = req.params;
      const cacheKey = `${CACHE_PREFIX}domain:${value}`;
      const result = await cachedLookup(cacheKey, () => lookupDomain(value));
      res.json({ ...result.data, cached: result.cached, looked_up_at: new Date().toISOString() });
    } catch (e: any) {
      logApp.error('[LOOKUP] Domain lookup error', { cause: e });
      res.status(500).json({ error: e.message });
    }
  });

  app.get(`${basePath}/lookup/hash/:value`, async (req: Express.Request, res: Express.Response) => {
    try {
      const context = await createAuthenticatedContext(req, res, 'lookup');
      if (!context.user) { res.sendStatus(403); return; }
      const { value } = req.params;
      const cacheKey = `${CACHE_PREFIX}hash:${value}`;
      const result = await cachedLookup(cacheKey, () => lookupHash(value));
      res.json({ ...result.data, cached: result.cached, looked_up_at: new Date().toISOString() });
    } catch (e: any) {
      logApp.error('[LOOKUP] Hash lookup error', { cause: e });
      res.status(500).json({ error: e.message });
    }
  });

  app.get(`${basePath}/lookup/cve/:value`, async (req: Express.Request, res: Express.Response) => {
    try {
      const context = await createAuthenticatedContext(req, res, 'lookup');
      if (!context.user) { res.sendStatus(403); return; }
      const { value } = req.params;
      const cacheKey = `${CACHE_PREFIX}cve:${value}`;
      const result = await cachedLookup(cacheKey, () => lookupCve(value));
      res.json({ ...result.data, cached: result.cached, looked_up_at: new Date().toISOString() });
    } catch (e: any) {
      logApp.error('[LOOKUP] CVE lookup error', { cause: e });
      res.status(500).json({ error: e.message });
    }
  });
};

export default initHttpLookup;
