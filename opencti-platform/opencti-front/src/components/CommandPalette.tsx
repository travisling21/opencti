import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { graphql } from 'react-relay';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import { useTheme } from '@mui/styles';
import {
  Search,
  HistoryOutlined,
  KeyboardReturnOutlined,
  KeyboardArrowUpOutlined,
  KeyboardArrowDownOutlined,
} from '@mui/icons-material';
import { fetchQuery } from 'react-relay';
import ItemIcon from './ItemIcon';
import { environment } from '../relay/environment';
import { useFormatter } from './i18n';
import type { Theme } from './Theme';

const RECENT_SEARCHES_KEY = 'opencti_command_palette_recent';
const MAX_RECENT = 8;
const SEARCH_DEBOUNCE_MS = 300;

const commandPaletteQuery = graphql`
  query CommandPaletteQuery(
    $search: String
    $count: Int!
  ) {
    globalSearch(
      search: $search
      first: $count
      orderBy: _score
      orderMode: desc
    ) {
      edges {
        node {
          id
          entity_type
          ... on StixObject {
            representative {
              main
            }
          }
          created_at
          createdBy {
            ... on Identity {
              name
            }
          }
        }
      }
    }
  }
`;

interface SearchResult {
  id: string;
  entity_type: string;
  name: string;
  created_at: string;
  createdBy: string | null;
}

interface RecentSearch {
  id: string;
  name: string;
  entity_type: string;
}

const getRecentSearches = (): RecentSearch[] => {
  try {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const addRecentSearch = (item: RecentSearch) => {
  const recent = getRecentSearches().filter((r) => r.id !== item.id);
  recent.unshift(item);
  localStorage.setItem(
    RECENT_SEARCHES_KEY,
    JSON.stringify(recent.slice(0, MAX_RECENT)),
  );
};

const entityTypeLabel = (entityType: string): string => {
  return entityType
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/-/g, ' ')
    .replace(/^Stix /, '');
};

const groupByEntityType = (results: SearchResult[]): Map<string, SearchResult[]> => {
  const groups = new Map<string, SearchResult[]>();
  for (const result of results) {
    const type = result.entity_type;
    if (!groups.has(type)) {
      groups.set(type, []);
    }
    groups.get(type)!.push(result);
  }
  return groups;
};

const CommandPalette: React.FC = () => {
  const theme = useTheme<Theme>();
  const navigate = useNavigate();
  const { t_i18n } = useFormatter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentSearches] = useState<RecentSearch[]>(getRecentSearches);

  const flatResults = useMemo(() => {
    if (query.trim().length === 0) {
      return recentSearches.map((r) => ({
        ...r,
        created_at: '',
        createdBy: null,
        isRecent: true,
      }));
    }
    return results.map((r) => ({ ...r, isRecent: false }));
  }, [query, results, recentSearches]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      fetchQuery(environment, commandPaletteQuery, {
        search: query.trim(),
        count: 20,
      }).toPromise().then((data: any) => {
        const edges = data?.globalSearch?.edges ?? [];
        const mapped: SearchResult[] = edges.map((edge: any) => ({
          id: edge.node.id,
          entity_type: edge.node.entity_type,
          name: edge.node.representative?.main ?? edge.node.id,
          created_at: edge.node.created_at ?? '',
          createdBy: edge.node.createdBy?.name ?? null,
        }));
        setResults(mapped);
        setSelectedIndex(0);
        setLoading(false);
      }).catch(() => {
        setLoading(false);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = useCallback((item: SearchResult | (RecentSearch & { isRecent?: boolean })) => {
    addRecentSearch({
      id: item.id,
      name: item.name,
      entity_type: item.entity_type,
    });
    setOpen(false);
    navigate(`/dashboard/id/${item.id}`);
  }, [navigate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && flatResults.length > 0) {
      e.preventDefault();
      handleSelect(flatResults[selectedIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }, [flatResults, selectedIndex, handleSelect]);

  useEffect(() => {
    const selectedEl = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    selectedEl?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const grouped = useMemo(() => {
    if (query.trim().length === 0) return null;
    return groupByEntityType(results);
  }, [query, results]);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone/.test(navigator.userAgent);
  const shortcutKey = isMac ? '⌘K' : 'Ctrl+K';

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      maxWidth="sm"
      fullWidth
      slotProps={{
        backdrop: {
          sx: { backgroundColor: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(2px)' },
        },
      }}
      PaperProps={{
        sx: {
          borderRadius: 2,
          backgroundColor: theme.palette.background.paper,
          border: `1px solid ${theme.palette.divider}`,
          maxHeight: '70vh',
          marginTop: '10vh',
          overflow: 'hidden',
        },
        elevation: 24,
      }}
      sx={{ '& .MuiDialog-container': { alignItems: 'flex-start' } }}
    >
      <Box sx={{ px: 2, pt: 2, pb: 1 }}>
        <TextField
          inputRef={inputRef}
          fullWidth
          placeholder={t_i18n('Search entities, indicators, reports...')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          variant="outlined"
          size="small"
          autoComplete="off"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  {loading
                    ? <CircularProgress size={20} />
                    : <Search sx={{ color: theme.palette.text.secondary }} />
                  }
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  <Chip
                    label="ESC"
                    size="small"
                    variant="outlined"
                    sx={{
                      height: 22,
                      fontSize: '0.7rem',
                      borderColor: theme.palette.divider,
                      color: theme.palette.text.secondary,
                    }}
                  />
                </InputAdornment>
              ),
              sx: {
                backgroundColor: theme.palette.background.default,
                borderRadius: 1,
              },
            },
          }}
        />
      </Box>

      <DialogContent sx={{ px: 1, py: 0, maxHeight: '55vh', overflowY: 'auto' }}>
        {query.trim().length === 0 && recentSearches.length > 0 && (
          <>
            <Typography
              variant="caption"
              sx={{
                px: 2,
                py: 1,
                display: 'block',
                color: theme.palette.text.secondary,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontSize: '0.68rem',
              }}
            >
              {t_i18n('Recent')}
            </Typography>
            <List ref={listRef} dense disablePadding>
              {recentSearches.map((item, index) => (
                <ListItem key={item.id} disablePadding data-index={index}>
                  <ListItemButton
                    selected={selectedIndex === index}
                    onClick={() => handleSelect({ ...item, created_at: '', createdBy: null })}
                    sx={{
                      borderRadius: 1,
                      mx: 1,
                      '&.Mui-selected': {
                        backgroundColor: theme.palette.action.selected,
                      },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <HistoryOutlined sx={{ fontSize: 18, color: theme.palette.text.secondary }} />
                    </ListItemIcon>
                    <ListItemText
                      primary={item.name}
                      secondary={entityTypeLabel(item.entity_type)}
                      slotProps={{
                        primary: { sx: { fontSize: '0.875rem' } },
                        secondary: { sx: { fontSize: '0.75rem' } },
                      }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </>
        )}

        {query.trim().length > 0 && !loading && results.length === 0 && (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {t_i18n('No results found')}
            </Typography>
          </Box>
        )}

        {grouped && (
          <List ref={listRef} dense disablePadding>
            {(() => {
              let globalIdx = 0;
              return Array.from(grouped.entries()).map(([entityType, items]) => (
                <Box key={entityType}>
                  <Typography
                    variant="caption"
                    sx={{
                      px: 2,
                      py: 0.75,
                      display: 'block',
                      color: theme.palette.text.secondary,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      fontSize: '0.68rem',
                    }}
                  >
                    {entityTypeLabel(entityType)}
                  </Typography>
                  {items.map((item) => {
                    const idx = globalIdx;
                    globalIdx += 1;
                    return (
                      <ListItem key={item.id} disablePadding data-index={idx}>
                        <ListItemButton
                          selected={selectedIndex === idx}
                          onClick={() => handleSelect(item)}
                          sx={{
                            borderRadius: 1,
                            mx: 1,
                            '&.Mui-selected': {
                              backgroundColor: theme.palette.action.selected,
                            },
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 36 }}>
                            <ItemIcon type={entityType} size="small" />
                          </ListItemIcon>
                          <ListItemText
                            primary={item.name}
                            secondary={item.createdBy ? `by ${item.createdBy}` : undefined}
                            slotProps={{
                              primary: {
                                sx: {
                                  fontSize: '0.875rem',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                },
                              },
                              secondary: { sx: { fontSize: '0.75rem' } },
                            }}
                          />
                          {selectedIndex === idx && (
                            <KeyboardReturnOutlined
                              sx={{ fontSize: 16, color: theme.palette.text.secondary, ml: 1 }}
                            />
                          )}
                        </ListItemButton>
                      </ListItem>
                    );
                  })}
                </Box>
              ));
            })()}
          </List>
        )}
      </DialogContent>

      <Box
        sx={{
          px: 2,
          py: 1,
          borderTop: `1px solid ${theme.palette.divider}`,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          backgroundColor: theme.palette.background.default,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <KeyboardArrowUpOutlined sx={{ fontSize: 14, color: theme.palette.text.secondary }} />
          <KeyboardArrowDownOutlined sx={{ fontSize: 14, color: theme.palette.text.secondary }} />
          <Typography variant="caption" color="text.secondary">
            {t_i18n('Navigate')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <KeyboardReturnOutlined sx={{ fontSize: 14, color: theme.palette.text.secondary }} />
          <Typography variant="caption" color="text.secondary">
            {t_i18n('Open')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
            ESC
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t_i18n('Close')}
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          {shortcutKey}
        </Typography>
      </Box>
    </Dialog>
  );
};

export default CommandPalette;
