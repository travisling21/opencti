import type Express from 'express';
import { basePath, logApp } from '../config/conf';
import { isUserHasCapability } from '../utils/access';
import { fullEntitiesOrRelationsList } from '../database/middleware';
import { ENTITY_TYPE_INDICATOR } from '../modules/indicator/indicator-types';
import { extractObservablesFromIndicatorPattern } from '../utils/syntax';
import type { BasicStoreEntityIndicator } from '../modules/indicator/indicator-types';
import { createAuthenticatedContext } from './httpAuthenticatedContext';
import { TAXIIAPI } from '../domain/user';
import { ForbiddenAccess } from '../config/errors';
import { FilterMode, FilterOperator, OrderingMode } from '../generated/graphql';

const BLOCKLIST_TYPE_MAP: Record<string, string[]> = {
  ip: ['IPv4-Addr', 'IPv6-Addr'],
  ipv4: ['IPv4-Addr'],
  ipv6: ['IPv6-Addr'],
  domain: ['Domain-Name'],
  url: ['Url'],
  hash: ['StixFile'],
  email: ['Email-Addr'],
};

const BLOCKLIST_SIZE_LIMIT = 10000;

const extractValuesFromIndicator = (indicator: BasicStoreEntityIndicator, allowedTypes: string[]): string[] => {
  if (!indicator.pattern) return [];
  try {
    const observables = extractObservablesFromIndicatorPattern(indicator.pattern);
    const values: string[] = [];
    for (const obs of observables) {
      if (obs.type && allowedTypes.includes(obs.type)) {
        if (obs.value) {
          values.push(obs.value);
        }
        if (obs.hashes) {
          for (const hashValue of Object.values(obs.hashes)) {
            if (typeof hashValue === 'string' && hashValue.length > 0) {
              values.push(hashValue);
            }
          }
        }
      }
    }
    return values;
  } catch {
    return [];
  }
};

const initHttpBlocklistFeeds = (app: Express.Application) => {
  app.get(`${basePath}/feeds/blocklist/:type`, async (req: Express.Request, res: Express.Response) => {
    const { type } = req.params as { type: string };
    const lowerType = type.toLowerCase();

    if (!BLOCKLIST_TYPE_MAP[lowerType]) {
      res.status(400).send({
        error: 'Invalid blocklist type',
        valid_types: Object.keys(BLOCKLIST_TYPE_MAP),
      });
      return;
    }

    try {
      const context = await createAuthenticatedContext(req, res, 'blocklist_feed');
      if (!context.user) {
        throw ForbiddenAccess();
      }
      if (!isUserHasCapability(context.user, TAXIIAPI)) {
        throw ForbiddenAccess();
      }

      const observableTypes = BLOCKLIST_TYPE_MAP[lowerType];
      const minConfidence = req.query.min_confidence ? parseInt(String(req.query.min_confidence), 10) : undefined;
      const format = (req.query.format as string) || 'plain';

      const now = new Date().toISOString();
      const queryArgs = {
        first: BLOCKLIST_SIZE_LIMIT,
        orderBy: ['created_at'],
        orderMode: OrderingMode.Desc,
        filters: {
          mode: FilterMode.And,
          filters: [
            {
              key: ['x_opencti_main_observable_type'],
              values: observableTypes,
              operator: FilterOperator.Eq,
              mode: FilterMode.Or,
            },
            {
              key: ['revoked'],
              values: ['false'],
              operator: FilterOperator.Eq,
              mode: FilterMode.Or,
            },
          ],
          filterGroups: [],
        },
      };
      const indicators = await fullEntitiesOrRelationsList<BasicStoreEntityIndicator>(
        context,
        context.user,
        [ENTITY_TYPE_INDICATOR],
        queryArgs,
      );

      const values = new Set<string>();
      for (const indicator of indicators) {
        if (indicator.valid_until && new Date(indicator.valid_until) < new Date(now)) {
          continue;
        }
        if (minConfidence !== undefined && (indicator as any).x_opencti_score < minConfidence) {
          continue;
        }
        const extracted = extractValuesFromIndicator(indicator, observableTypes);
        for (const val of extracted) {
          values.add(val);
        }
      }

      const sortedValues = Array.from(values).sort();

      if (format === 'json') {
        res.set('Content-Type', 'application/json');
        res.json({
          type: lowerType,
          observable_types: observableTypes,
          count: sortedValues.length,
          generated_at: now,
          values: sortedValues,
        });
      } else {
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.set('X-Blocklist-Type', lowerType);
        res.set('X-Blocklist-Count', String(sortedValues.length));
        res.set('X-Blocklist-Generated', now);
        for (const val of sortedValues) {
          res.write(val);
          res.write('\n');
        }
        res.end();
      }
    } catch (e: any) {
      if (e.name === 'ForbiddenAccess' || e.name === 'AuthRequired') {
        res.status(403).send({ error: 'Authentication required with TAXII API capability' });
      } else {
        logApp.error('Error in blocklist feed', { cause: e });
        res.status(500).send({ error: 'Internal server error' });
      }
    }
  });
};

export default initHttpBlocklistFeeds;
