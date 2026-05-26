import React, { useCallback, useState } from 'react';
import Drawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import { useTheme } from '@mui/styles';
import {
  TravelExploreOutlined,
  CachedOutlined,
  SecurityOutlined,
  DnsOutlined,
  FingerprintOutlined,
  BugReportOutlined,
} from '@mui/icons-material';
import IconButton from '@mui/material/IconButton';
import Markdown from 'react-markdown';
import { APP_BASE_PATH } from '../../../../relay/environment';
import { useFormatter } from '../../../../components/i18n';
import type { Theme } from '../../../../components/Theme';

type LookupType = 'ip' | 'domain' | 'hash' | 'cve';

const extractLookupValue = (value: string): { type: LookupType; extracted: string } | null => {
  const trimmed = value.trim();

  if (/^CVE-\d{4}-\d+$/i.test(trimmed)) return { type: 'cve', extracted: trimmed };
  if (/^[0-9a-f]{32}$/i.test(trimmed) || /^[0-9a-f]{40}$/i.test(trimmed) || /^[0-9a-f]{64}$/i.test(trimmed)) return { type: 'hash', extracted: trimmed };
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) return { type: 'ip', extracted: trimmed };
  if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(trimmed)) return { type: 'domain', extracted: trimmed };

  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `http://${trimmed}`);
    const host = url.hostname;
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return { type: 'ip', extracted: host };
    if (host.includes('.')) return { type: 'domain', extracted: host };
  } catch {
    // not a URL
  }

  const ipMatch = trimmed.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
  if (ipMatch) return { type: 'ip', extracted: ipMatch[1] };

  const cveMatch = trimmed.match(/(CVE-\d{4}-\d+)/i);
  if (cveMatch) return { type: 'cve', extracted: cveMatch[1] };

  return null;
};

const lookupTypeInfo: Record<LookupType, { icon: React.ReactElement; label: string; color: string }> = {
  ip: { icon: <SecurityOutlined sx={{ fontSize: 18 }} />, label: 'IP Reputation', color: '#f44336' },
  domain: { icon: <DnsOutlined sx={{ fontSize: 18 }} />, label: 'Domain Analysis', color: '#2196f3' },
  hash: { icon: <FingerprintOutlined sx={{ fontSize: 18 }} />, label: 'Hash Lookup', color: '#ff9800' },
  cve: { icon: <BugReportOutlined sx={{ fontSize: 18 }} />, label: 'CVE Details', color: '#9c27b0' },
};

interface SourceData {
  source: string;
  [key: string]: any;
}

interface ExternalLookupProps {
  observableValue: string;
  entityType?: string;
}

const ExternalLookup: React.FC<ExternalLookupProps> = ({ observableValue, entityType }) => {
  const theme = useTheme<Theme>();
  const { t_i18n } = useFormatter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const lookupMatch = extractLookupValue(observableValue);
  const lookupType = lookupMatch?.type ?? null;
  const lookupValue = lookupMatch?.extracted ?? observableValue;

  const handleLookup = useCallback(async () => {
    if (!lookupType) return;
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${APP_BASE_PATH}/lookup/${lookupType}/${encodeURIComponent(lookupValue)}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      setError(e.message || 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }, [lookupType, lookupValue]);

  if (!lookupType) return null;

  const info = lookupTypeInfo[lookupType];

  const renderSourceData = (source: SourceData) => {
    const entries = Object.entries(source).filter(([k]) => k !== 'source');
    return (
      <Box key={source.source} sx={{ mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5, color: info.color }}>
          {source.source}
        </Typography>
        <List dense disablePadding>
          {entries.map(([key, value]) => {
            if (value === null || value === undefined || value === '') return null;
            const displayValue = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
            return (
              <ListItem key={key} sx={{ py: 0.25, px: 0 }}>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                      <Typography variant="body2" sx={{ color: theme.palette.text.secondary, fontSize: '0.8rem', minWidth: 140 }}>
                        {key.replace(/_/g, ' ')}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          fontSize: '0.8rem',
                          fontFamily: typeof value === 'object' ? 'monospace' : 'inherit',
                          whiteSpace: typeof value === 'object' ? 'pre-wrap' : 'normal',
                          wordBreak: 'break-all',
                          textAlign: 'right',
                        }}
                      >
                        {displayValue}
                      </Typography>
                    </Box>
                  }
                />
              </ListItem>
            );
          })}
        </List>
      </Box>
    );
  };

  return (
    <>
      <Tooltip title={`${info.label}: ${lookupValue}`}>
        <IconButton onClick={handleLookup} size="small" sx={{ color: info.color }}>
          <TravelExploreOutlined sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>

      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        PaperProps={{
          sx: {
            width: 450,
            backgroundColor: theme.palette.background.paper,
          },
        }}
      >
        <Box sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            {info.icon}
            <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 600 }}>
              {info.label}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <Chip
              label={lookupValue}
              size="small"
              sx={{ fontFamily: 'monospace', fontSize: '0.8rem', maxWidth: 350 }}
            />
            {result?.cached && (
              <Tooltip title={t_i18n('Cached result (24h)')}>
                <CachedOutlined sx={{ fontSize: 16, color: theme.palette.text.secondary }} />
              </Tooltip>
            )}
          </Box>

          <Divider sx={{ mb: 2 }} />

          {loading && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4, gap: 2 }}>
              <CircularProgress size={32} />
              <Typography variant="body2" color="text.secondary">
                {t_i18n('Looking up...')}
              </Typography>
            </Box>
          )}

          {error && (
            <Typography variant="body2" color="error" sx={{ py: 2 }}>
              {error}
            </Typography>
          )}

          {result && !loading && (
            <>
              {result.sources && result.sources.length > 0 ? (
                result.sources.map((source: SourceData) => renderSourceData(source))
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                  {t_i18n('No results found from any source')}
                </Typography>
              )}

              {result.looked_up_at && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2, textAlign: 'right' }}>
                  {t_i18n('Looked up')}: {new Date(result.looked_up_at).toLocaleString()}
                </Typography>
              )}
            </>
          )}
        </Box>
      </Drawer>
    </>
  );
};

export default ExternalLookup;
