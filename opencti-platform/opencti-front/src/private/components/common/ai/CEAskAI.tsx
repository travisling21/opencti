import React, { useState } from 'react';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/styles';
import {
  AutoAwesomeOutlined,
  SummarizeOutlined,
  SpellcheckOutlined,
  CompressOutlined,
  ExpandOutlined,
  WorkOutline,
  HelpOutlineOutlined,
} from '@mui/icons-material';
import { APP_BASE_PATH, MESSAGING$ } from '../../../../relay/environment';
import { useFormatter } from '../../../../components/i18n';
import type { Theme } from '../../../../components/Theme';

interface CEAskAIProps {
  currentValue: string;
  setFieldValue: (value: string) => void;
  disabled?: boolean;
}

const ACTIONS: { key: string; label: string; icon: React.ReactElement; tone?: string }[] = [
  { key: 'summarize', label: 'Summarize', icon: <SummarizeOutlined fontSize="small" /> },
  { key: 'fix_spelling', label: 'Fix spelling & grammar', icon: <SpellcheckOutlined fontSize="small" /> },
  { key: 'shorter', label: 'Make shorter', icon: <CompressOutlined fontSize="small" /> },
  { key: 'longer', label: 'Make longer', icon: <ExpandOutlined fontSize="small" /> },
  { key: 'change_tone', label: 'More formal', icon: <WorkOutline fontSize="small" />, tone: 'formal' },
  { key: 'explain', label: 'Explain', icon: <HelpOutlineOutlined fontSize="small" /> },
];

const CEAskAI: React.FC<CEAskAIProps> = ({ currentValue, setFieldValue, disabled }) => {
  const theme = useTheme<Theme>();
  const { t_i18n } = useFormatter();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const aiColor = theme.palette.ai?.main ?? theme.palette.primary.main;

  const run = async (action: string, tone?: string) => {
    setAnchorEl(null);
    if (!currentValue || currentValue.trim().length < 2) {
      MESSAGING$.notifyError(t_i18n('Nothing to process — the field is empty.'));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${APP_BASE_PATH}/ai/text`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: currentValue, action, tone }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResult(data.result);
    } catch (e: any) {
      MESSAGING$.notifyError(e.message || t_i18n('AI request failed'));
    } finally {
      setLoading(false);
    }
  };

  const applyResult = () => {
    if (result !== null) setFieldValue(result);
    setResult(null);
  };

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        disabled={disabled || loading}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        startIcon={loading ? <CircularProgress size={14} /> : <AutoAwesomeOutlined sx={{ fontSize: 16 }} />}
        sx={{
          textTransform: 'none',
          mt: 0.5,
          color: aiColor,
          borderColor: aiColor,
          '&:hover': { borderColor: aiColor, backgroundColor: `${aiColor}14` },
        }}
      >
        {t_i18n('Ask AI')}
      </Button>

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        {ACTIONS.map((a) => (
          <MenuItem key={a.label} onClick={() => run(a.key, a.tone)} dense>
            <ListItemIcon sx={{ color: aiColor }}>{a.icon}</ListItemIcon>
            <ListItemText primary={t_i18n(a.label)} />
          </MenuItem>
        ))}
      </Menu>

      <Dialog open={result !== null} onClose={() => setResult(null)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoAwesomeOutlined sx={{ color: aiColor }} />
          {t_i18n('AI suggestion')}
        </DialogTitle>
        <DialogContent>
          <Box
            sx={{
              p: 2,
              borderRadius: 1,
              backgroundColor: theme.palette.background.default,
              border: `1px solid ${theme.palette.divider}`,
              whiteSpace: 'pre-wrap',
              fontSize: '0.875rem',
              maxHeight: '50vh',
              overflowY: 'auto',
            }}
          >
            <Typography variant="body2" component="div" sx={{ whiteSpace: 'pre-wrap' }}>
              {result}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResult(null)} variant="outlined" sx={{ textTransform: 'none' }}>
            {t_i18n('Discard')}
          </Button>
          <Button onClick={applyResult} variant="contained" sx={{ textTransform: 'none' }}>
            {t_i18n('Replace field')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default CEAskAI;
