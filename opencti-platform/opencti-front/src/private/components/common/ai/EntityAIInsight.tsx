import React, { useCallback, useState } from 'react';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import { useTheme } from '@mui/styles';
import { AutoAwesomeOutlined, RefreshOutlined, CachedOutlined } from '@mui/icons-material';
import Markdown from 'react-markdown';
import { APP_BASE_PATH } from '../../../../relay/environment';
import { useFormatter } from '../../../../components/i18n';
import type { Theme } from '../../../../components/Theme';

interface EntityAIInsightProps {
  entityId: string;
}

interface InsightData {
  insight: string;
  generated_at?: string;
  cached?: boolean;
}

const EntityAIInsight: React.FC<EntityAIInsightProps> = ({ entityId }) => {
  const theme = useTheme<Theme>();
  const { t_i18n } = useFormatter();
  const [data, setData] = useState<InsightData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInsight = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = `${APP_BASE_PATH}/ai/entity-insight/${encodeURIComponent(entityId)}${refresh ? '?refresh=true' : ''}`;
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e: any) {
      setError(e.message || 'Failed to generate insight');
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  return (
    <Card
      variant="outlined"
      sx={{
        mb: 3,
        borderRadius: 1.5,
        border: `1px solid ${theme.palette.divider}`,
      }}
    >
      <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: data || loading ? 1 : 0 }}>
          <AutoAwesomeOutlined sx={{ fontSize: 20, color: theme.palette.ai?.main ?? theme.palette.primary.main }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '0.9rem', flex: 1 }}>
            {t_i18n('AI Insight')}
          </Typography>
          {data?.cached && (
            <Tooltip title={t_i18n('Cached result (1h)')}>
              <CachedOutlined sx={{ fontSize: 16, color: theme.palette.text.secondary }} />
            </Tooltip>
          )}
          {data && (
            <Tooltip title={t_i18n('Regenerate')}>
              <IconButton size="small" onClick={() => fetchInsight(true)} disabled={loading}>
                {loading ? <CircularProgress size={16} /> : <RefreshOutlined sx={{ fontSize: 16 }} />}
              </IconButton>
            </Tooltip>
          )}
        </Box>

        {!data && !loading && !error && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<AutoAwesomeOutlined sx={{ fontSize: 16 }} />}
            onClick={() => fetchInsight(false)}
            sx={{ textTransform: 'none', mt: 1 }}
          >
            {t_i18n('Generate AI insight')}
          </Button>
        )}

        {loading && !data && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">
              {t_i18n('Analyzing entity with AI...')}
            </Typography>
          </Box>
        )}

        {error && (
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            {error}
          </Typography>
        )}

        {data && (
          <Box
            sx={{
              fontSize: '0.825rem',
              lineHeight: 1.6,
              '& p': { fontSize: '0.825rem', lineHeight: 1.6, my: 0.5 },
              '& ul, & ol': { fontSize: '0.825rem', pl: 2.5, my: 0.5 },
              '& strong': { fontWeight: 600 },
              color: theme.palette.text.primary,
            }}
          >
            <Markdown>{data.insight}</Markdown>
            {data.generated_at && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                {t_i18n('Generated')}: {new Date(data.generated_at).toLocaleString()}
              </Typography>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default EntityAIInsight;
