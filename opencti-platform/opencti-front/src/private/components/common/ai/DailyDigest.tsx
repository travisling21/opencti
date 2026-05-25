import React, { useCallback, useEffect, useState } from 'react';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import { useTheme } from '@mui/styles';
import { AutoAwesomeOutlined, RefreshOutlined } from '@mui/icons-material';
import Markdown from 'react-markdown';
import { APP_BASE_PATH } from '../../../../relay/environment';
import { useFormatter } from '../../../../components/i18n';
import type { Theme } from '../../../../components/Theme';

interface DigestData {
  date: string;
  content: string;
  generated_at: string;
}

interface DailyDigestProps {
  height?: number;
}

const DailyDigest: React.FC<DailyDigestProps> = ({ height = 500 }) => {
  const theme = useTheme<Theme>();
  const { t_i18n } = useFormatter();
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDigest = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = `${APP_BASE_PATH}/ai/daily-digest${refresh ? '?refresh=true' : ''}`;
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDigest(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load digest');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDigest();
  }, [fetchDigest]);

  const generatedTime = digest?.generated_at
    ? new Date(digest.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <Card
      variant="outlined"
      sx={{
        height,
        borderRadius: 1.5,
        border: `1px solid ${theme.palette.divider}`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <CardHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoAwesomeOutlined sx={{ fontSize: 20, color: theme.palette.primary.main }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '0.9rem' }}>
              {t_i18n('AI Daily Threat Briefing')}
            </Typography>
            {digest?.date && (
              <Typography variant="caption" sx={{ color: theme.palette.text.secondary, ml: 1 }}>
                {digest.date}
                {generatedTime ? ` at ${generatedTime}` : ''}
              </Typography>
            )}
          </Box>
        }
        action={
          <Tooltip title={t_i18n('Regenerate briefing')}>
            <IconButton
              onClick={() => fetchDigest(true)}
              disabled={loading}
              size="small"
            >
              {loading ? <CircularProgress size={18} /> : <RefreshOutlined sx={{ fontSize: 18 }} />}
            </IconButton>
          </Tooltip>
        }
        sx={{ pb: 0, pt: 1.5, px: 2 }}
      />
      <CardContent
        sx={{
          pt: 1,
          px: 2,
          pb: 2,
          flex: 1,
          overflowY: 'auto',
          '&:last-child': { pb: 2 },
          '& h1': { fontSize: '1.1rem', fontWeight: 700, mt: 1.5, mb: 0.5 },
          '& h2': { fontSize: '0.95rem', fontWeight: 600, mt: 1.5, mb: 0.5 },
          '& h3': { fontSize: '0.85rem', fontWeight: 600, mt: 1, mb: 0.5 },
          '& p': { fontSize: '0.825rem', lineHeight: 1.6, mb: 0.75, mt: 0 },
          '& ul, & ol': { fontSize: '0.825rem', pl: 2.5, mb: 0.75 },
          '& li': { mb: 0.25, lineHeight: 1.5 },
          '& strong': { fontWeight: 600 },
          '& code': {
            backgroundColor: theme.palette.background.default,
            px: 0.5,
            py: 0.25,
            borderRadius: 0.5,
            fontSize: '0.8rem',
          },
        }}
      >
        {error && (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        )}
        {loading && !digest && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2 }}>
            <CircularProgress size={32} />
            <Typography variant="body2" color="text.secondary">
              {t_i18n('Generating threat briefing with AI...')}
            </Typography>
          </Box>
        )}
        {digest && (
          <Markdown>{digest.content}</Markdown>
        )}
      </CardContent>
    </Card>
  );
};

export default DailyDigest;
