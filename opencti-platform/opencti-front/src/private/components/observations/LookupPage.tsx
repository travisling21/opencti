import React, { useCallback, useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import InputAdornment from '@mui/material/InputAdornment';
import { useTheme } from '@mui/styles';
import {
  TravelExploreOutlined,
  CachedOutlined,
  SecurityOutlined,
  DnsOutlined,
  FingerprintOutlined,
  BugReportOutlined,
  SearchOutlined,
} from '@mui/icons-material';
import { APP_BASE_PATH } from '../../../relay/environment';
import { useFormatter } from '../../../components/i18n';
import useConnectedDocumentModifier from '../../../utils/hooks/useConnectedDocumentModifier';
import Breadcrumbs from '../../../components/Breadcrumbs';
import type { Theme } from '../../../components/Theme';

type LookupType = 'ip' | 'domain' | 'hash' | 'cve';

const lookupTypes: { value: LookupType; label: string; icon: React.ReactElement; color: string; placeholder: string }[] = [
  { value: 'ip', label: 'IP Address', icon: <SecurityOutlined sx={{ fontSize: 18 }} />, color: '#f44336', placeholder: '8.8.8.8' },
  { value: 'domain', label: 'Domain', icon: <DnsOutlined sx={{ fontSize: 18 }} />, color: '#2196f3', placeholder: 'example.com' },
  { value: 'hash', label: 'File Hash', icon: <FingerprintOutlined sx={{ fontSize: 18 }} />, color: '#ff9800', placeholder: 'SHA-256, SHA-1, or MD5' },
  { value: 'cve', label: 'CVE', icon: <BugReportOutlined sx={{ fontSize: 18 }} />, color: '#9c27b0', placeholder: 'CVE-2024-12345' },
];

interface SourceData {
  source: string;
  [key: string]: any;
}

const LookupPage: React.FC = () => {
  const theme = useTheme<Theme>();
  const { t_i18n } = useFormatter();
  const { setTitle } = useConnectedDocumentModifier();
  setTitle(t_i18n('External Lookup | Observations'));

  const [selectedType, setSelectedType] = useState<LookupType>('ip');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<{ type: LookupType; value: string; timestamp: string }[]>([]);

  const currentType = lookupTypes.find((t) => t.value === selectedType)!;

  const handleLookup = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${APP_BASE_PATH}/lookup/${selectedType}/${encodeURIComponent(query.trim())}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(data);
      setSearchHistory((prev) => [
        { type: selectedType, value: query.trim(), timestamp: new Date().toISOString() },
        ...prev.filter((h) => !(h.type === selectedType && h.value === query.trim())).slice(0, 9),
      ]);
    } catch (e: any) {
      setError(e.message || 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }, [selectedType, query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLookup();
  };

  const handleHistoryClick = (type: LookupType, value: string) => {
    setSelectedType(type);
    setQuery(value);
  };

  const renderValue = (key: string, value: any): React.ReactNode => {
    if (value === null || value === undefined || value === '') return null;
    if (Array.isArray(value)) {
      if (value.length === 0) return null;
      if (typeof value[0] === 'object') {
        return (
          <Box sx={{ ml: 2, mt: 0.5 }}>
            {value.map((item, i) => (
              <Box key={i} sx={{ mb: 1, p: 1, borderRadius: 1, backgroundColor: theme.palette.background.default }}>
                {Object.entries(item).map(([k, v]) => (
                  <Typography key={k} variant="body2" sx={{ fontSize: '0.8rem' }}>
                    <strong>{k.replace(/_/g, ' ')}:</strong> {String(v)}
                  </Typography>
                ))}
              </Box>
            ))}
          </Box>
        );
      }
      return (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {value.map((v, i) => (
            <Chip key={i} label={String(v)} size="small" sx={{ fontSize: '0.75rem' }} />
          ))}
        </Box>
      );
    }
    if (typeof value === 'object') {
      return (
        <Box sx={{ ml: 2, mt: 0.5 }}>
          {Object.entries(value).map(([k, v]) => (
            <Typography key={k} variant="body2" sx={{ fontSize: '0.8rem' }}>
              <strong>{k.replace(/_/g, ' ')}:</strong> {String(v)}
            </Typography>
          ))}
        </Box>
      );
    }
    return String(value);
  };

  const renderSourceData = (source: SourceData) => {
    const entries = Object.entries(source).filter(([k]) => k !== 'source');
    return (
      <Card key={source.source} variant="outlined" sx={{ mb: 2, borderColor: currentType.color + '40' }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: currentType.color }}>
            {source.source}
          </Typography>
          <List dense disablePadding>
            {entries.map(([key, value]) => {
              const rendered = renderValue(key, value);
              if (rendered === null) return null;
              return (
                <ListItem key={key} sx={{ py: 0.5, px: 0, alignItems: 'flex-start' }}>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                        <Typography variant="body2" sx={{ color: theme.palette.text.secondary, fontSize: '0.8rem', minWidth: 160, flexShrink: 0, pt: 0.25 }}>
                          {key.replace(/_/g, ' ')}
                        </Typography>
                        <Box sx={{ flex: 1, textAlign: 'right', wordBreak: 'break-all' }}>
                          <Typography component="span" variant="body2" sx={{ fontSize: '0.8rem' }}>
                            {rendered}
                          </Typography>
                        </Box>
                      </Box>
                    }
                  />
                </ListItem>
              );
            })}
          </List>
        </CardContent>
      </Card>
    );
  };

  return (
    <div style={{ paddingBottom: 40 }}>
      <Breadcrumbs elements={[
        { label: t_i18n('Observations') },
        { label: t_i18n('External Lookup'), current: true },
      ]}
      />

      <Box sx={{ display: 'flex', gap: 3, mt: 2 }}>
        <Box sx={{ flex: 1, maxWidth: 800 }}>
          <Card variant="outlined" sx={{ mb: 3 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <TravelExploreOutlined sx={{ fontSize: 24, color: theme.palette.primary.main }} />
                <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 600 }}>
                  {t_i18n('External Intelligence Lookup')}
                </Typography>
              </Box>

              <ToggleButtonGroup
                value={selectedType}
                exclusive
                onChange={(_, v) => v && setSelectedType(v)}
                size="small"
                sx={{ mb: 2, display: 'flex' }}
              >
                {lookupTypes.map((lt) => (
                  <ToggleButton
                    key={lt.value}
                    value={lt.value}
                    sx={{
                      flex: 1,
                      gap: 0.5,
                      textTransform: 'none',
                      fontSize: '0.8rem',
                      '&.Mui-selected': {
                        backgroundColor: lt.color + '18',
                        color: lt.color,
                        borderColor: lt.color,
                      },
                    }}
                  >
                    {lt.icon}
                    {lt.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>

              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder={currentType.placeholder}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoComplete="off"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchOutlined sx={{ fontSize: 20, color: theme.palette.text.secondary }} />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
                <Button
                  variant="contained"
                  onClick={handleLookup}
                  disabled={loading || !query.trim()}
                  sx={{ minWidth: 100, textTransform: 'none' }}
                >
                  {loading ? <CircularProgress size={20} color="inherit" /> : t_i18n('Lookup')}
                </Button>
              </Box>
            </CardContent>
          </Card>

          {error && (
            <Card variant="outlined" sx={{ mb: 2, borderColor: theme.palette.error.main }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="body2" color="error">{error}</Typography>
              </CardContent>
            </Card>
          )}

          {loading && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 6, gap: 2 }}>
              <CircularProgress size={36} />
              <Typography variant="body2" color="text.secondary">
                {t_i18n('Querying external sources...')}
              </Typography>
            </Box>
          )}

          {result && !loading && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {t_i18n('Results')}
                </Typography>
                <Chip
                  label={result[selectedType] || result.ip || result.domain || result.hash || result.cve || query}
                  size="small"
                  sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                />
                {result.cached && (
                  <Tooltip title={t_i18n('Cached result (24h)')}>
                    <Chip icon={<CachedOutlined sx={{ fontSize: 14 }} />} label="Cached" size="small" variant="outlined" />
                  </Tooltip>
                )}
              </Box>

              {result.hash_type && result.hash_type !== 'unknown' && (
                <Chip label={result.hash_type} size="small" sx={{ mb: 1, fontSize: '0.75rem' }} />
              )}

              {result.sources && result.sources.length > 0 ? (
                result.sources.map((source: SourceData) => renderSourceData(source))
              ) : (
                <Card variant="outlined" sx={{ mb: 2 }}>
                  <CardContent sx={{ py: 3, textAlign: 'center', '&:last-child': { pb: 3 } }}>
                    <Typography variant="body2" color="text.secondary">
                      {t_i18n('No results found from any source')}
                    </Typography>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </Box>

        <Box sx={{ width: 280, flexShrink: 0 }}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5, fontSize: '0.85rem' }}>
                {t_i18n('Recent Lookups')}
              </Typography>
              {searchHistory.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                  {t_i18n('No lookups yet')}
                </Typography>
              ) : (
                <List dense disablePadding>
                  {searchHistory.map((h, i) => {
                    const lt = lookupTypes.find((t) => t.value === h.type)!;
                    return (
                      <ListItem
                        key={`${h.type}-${h.value}-${i}`}
                        sx={{
                          px: 1,
                          py: 0.5,
                          borderRadius: 1,
                          cursor: 'pointer',
                          '&:hover': { backgroundColor: theme.palette.action.hover },
                        }}
                        onClick={() => handleHistoryClick(h.type, h.value)}
                      >
                        <Box sx={{ color: lt.color, mr: 1, display: 'flex' }}>{lt.icon}</Box>
                        <ListItemText
                          primary={h.value}
                          secondary={new Date(h.timestamp).toLocaleTimeString()}
                          slotProps={{
                            primary: {
                              sx: {
                                fontSize: '0.8rem',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              },
                            },
                            secondary: { sx: { fontSize: '0.7rem' } },
                          }}
                        />
                      </ListItem>
                    );
                  })}
                </List>
              )}
            </CardContent>
          </Card>

          <Card variant="outlined" sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, fontSize: '0.85rem' }}>
                {t_i18n('Sources')}
              </Typography>
              <Divider sx={{ mb: 1 }} />
              <Typography variant="body2" sx={{ fontSize: '0.75rem', mb: 0.5 }}>
                <strong>IP:</strong> AbuseIPDB, IP Geolocation
              </Typography>
              <Typography variant="body2" sx={{ fontSize: '0.75rem', mb: 0.5 }}>
                <strong>Domain:</strong> Google DNS, MX Records
              </Typography>
              <Typography variant="body2" sx={{ fontSize: '0.75rem', mb: 0.5 }}>
                <strong>Hash:</strong> MalwareBazaar
              </Typography>
              <Typography variant="body2" sx={{ fontSize: '0.75rem' }}>
                <strong>CVE:</strong> NVD (NIST)
              </Typography>
            </CardContent>
          </Card>
        </Box>
      </Box>
    </div>
  );
};

export default LookupPage;
