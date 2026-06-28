import React, { useCallback, useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import CircularProgress from '@mui/material/CircularProgress';
import InputAdornment from '@mui/material/InputAdornment';
import { useTheme } from '@mui/styles';
import { DescriptionOutlined, SearchOutlined } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { APP_BASE_PATH } from '../../../relay/environment';
import { useFormatter } from '../../../components/i18n';
import useConnectedDocumentModifier from '../../../utils/hooks/useConnectedDocumentModifier';
import Breadcrumbs from '../../../components/Breadcrumbs';
import type { Theme } from '../../../components/Theme';

interface DocResult {
  file_id: string;
  name: string;
  entity_id: string | null;
  indexed_at: string;
  score: number;
  snippet: string;
}

// Render a snippet that uses {{HL}}...{{/HL}} markers (set by the backend) as
// highlighted spans. React escapes the plain text parts, so this is XSS-safe.
const HighlightedSnippet: React.FC<{ snippet: string }> = ({ snippet }) => {
  const theme = useTheme<Theme>();
  const parts = snippet.split(/(\{\{HL\}\}|\{\{\/HL\}\})/);
  let highlighted = false;
  return (
    <>
      {parts.map((part, i) => {
        if (part === '{{HL}}') { highlighted = true; return null; }
        if (part === '{{/HL}}') { highlighted = false; return null; }
        return (
          <Box
            component="span"
            key={i}
            sx={highlighted ? { backgroundColor: `${theme.palette.primary.main}33`, fontWeight: 600, borderRadius: 0.5 } : undefined}
          >
            {part}
          </Box>
        );
      })}
    </>
  );
};

const DocumentSearch: React.FC = () => {
  const theme = useTheme<Theme>();
  const navigate = useNavigate();
  const { t_i18n } = useFormatter();
  const { setTitle } = useConnectedDocumentModifier();
  setTitle(t_i18n('Document Search | Data'));

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<DocResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    if (query.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${APP_BASE_PATH}/search/documents?q=${encodeURIComponent(query.trim())}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResults(data.results ?? []);
      setSearched(true);
    } catch (e: any) {
      setError(e.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [query]);

  return (
    <div style={{ paddingBottom: 40 }}>
      <Breadcrumbs elements={[{ label: t_i18n('Data') }, { label: t_i18n('Document Search'), current: true }]} />

      <Card variant="outlined" sx={{ mt: 2, mb: 3, maxWidth: 900 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <DescriptionOutlined sx={{ fontSize: 24, color: theme.palette.primary.main }} />
            <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 600 }}>
              {t_i18n('Document content search')}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t_i18n('Full-text search across the contents of uploaded files (PDF, Office documents, text). Only files you are permitted to access are returned.')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              fullWidth
              size="small"
              placeholder={t_i18n('Search inside documents...')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
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
              onClick={search}
              disabled={loading || query.trim().length < 2}
              sx={{ minWidth: 100, textTransform: 'none' }}
            >
              {loading ? <CircularProgress size={20} color="inherit" /> : t_i18n('Search')}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {error && (
        <Typography variant="body2" color="error" sx={{ mb: 2 }}>{error}</Typography>
      )}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={32} />
        </Box>
      )}

      {searched && !loading && results.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          {t_i18n('No documents matched your search.')}
        </Typography>
      )}

      {results.length > 0 && (
        <Card variant="outlined" sx={{ maxWidth: 900 }}>
          <List disablePadding>
            {results.map((r) => (
              <ListItem key={r.file_id} disablePadding divider>
                <ListItemButton
                  onClick={() => r.entity_id && navigate(`/dashboard/id/${r.entity_id}`)}
                  disabled={!r.entity_id}
                  sx={{ display: 'block', py: 1.5 }}
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <DescriptionOutlined sx={{ fontSize: 16, color: theme.palette.text.secondary }} />
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.name}</Typography>
                      </Box>
                    }
                    secondary={
                      <Typography
                        component="span"
                        variant="body2"
                        sx={{ display: 'block', mt: 0.5, fontSize: '0.8rem', color: theme.palette.text.secondary, lineHeight: 1.5 }}
                      >
                        <HighlightedSnippet snippet={r.snippet} />
                      </Typography>
                    }
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
};

export default DocumentSearch;
