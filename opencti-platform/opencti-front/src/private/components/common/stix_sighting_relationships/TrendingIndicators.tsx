import React from 'react';
import { graphql, usePreloadedQuery, PreloadedQuery } from 'react-relay';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { useTheme } from '@mui/styles';
import { TrendingUpOutlined, VisibilityOutlined } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import ItemIcon from '../../../../components/ItemIcon';
import { useFormatter } from '../../../../components/i18n';
import useQueryLoading from '../../../../utils/hooks/useQueryLoading';
import Loader, { LoaderVariant } from '../../../../components/Loader';
import type { Theme } from '../../../../components/Theme';
import type {
  TrendingIndicatorsQuery,
  TrendingIndicatorsQuery$data,
} from './__generated__/TrendingIndicatorsQuery.graphql';

const trendingIndicatorsQuery = graphql`
  query TrendingIndicatorsQuery(
    $field: String!
    $operation: StatsOperation!
    $startDate: DateTime
    $endDate: DateTime
    $limit: Int
    $order: String
    $fromTypes: [String]
  ) {
    stixSightingRelationshipsDistribution(
      field: $field
      operation: $operation
      startDate: $startDate
      endDate: $endDate
      limit: $limit
      order: $order
      fromTypes: $fromTypes
    ) {
      label
      value
      entity {
        ... on BasicObject {
          id
          entity_type
        }
        ... on StixObject {
          representative {
            main
          }
        }
        ... on Indicator {
          pattern_type
          x_opencti_main_observable_type
          x_opencti_score
        }
      }
    }
  }
`;

interface TrendingIndicatorsComponentProps {
  queryRef: PreloadedQuery<TrendingIndicatorsQuery>;
  height: number;
}

const TrendingIndicatorsComponent: React.FC<TrendingIndicatorsComponentProps> = ({
  queryRef,
  height,
}) => {
  const theme = useTheme<Theme>();
  const navigate = useNavigate();
  const { t_i18n } = useFormatter();

  const data: TrendingIndicatorsQuery$data = usePreloadedQuery(trendingIndicatorsQuery, queryRef);
  const distribution = data.stixSightingRelationshipsDistribution ?? [];
  const maxValue = distribution.length > 0 ? (distribution[0]?.value ?? 1) : 1;

  if (distribution.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: height - 60,
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {t_i18n('No sighting data available')}
        </Typography>
      </Box>
    );
  }

  return (
    <List dense disablePadding sx={{ overflow: 'auto', maxHeight: height - 60 }}>
      {distribution.map((item, index) => {
        if (!item || !item.entity) return null;
        const entity = item.entity as any;
        const name = entity.representative?.main ?? item.label;
        const entityType = entity.entity_type ?? 'Indicator';
        const sightingCount = item.value ?? 0;
        const score = entity.x_opencti_score;
        const barWidth = maxValue > 0 ? (sightingCount / maxValue) * 100 : 0;
        const entityId = entity.id;

        return (
          <ListItem key={item.label ?? index} disablePadding>
            <ListItemButton
              onClick={() => entityId && navigate(`/dashboard/id/${entityId}`)}
              sx={{ borderRadius: 1, mx: 0.5, my: 0.25, position: 'relative', overflow: 'hidden' }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${barWidth}%`,
                  backgroundColor: theme.palette.primary.main,
                  opacity: 0.08,
                  transition: 'width 0.3s ease',
                }}
              />
              <ListItemIcon sx={{ minWidth: 32 }}>
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 700,
                    color: index < 3 ? theme.palette.primary.main : theme.palette.text.secondary,
                    fontSize: '0.75rem',
                    width: 20,
                    textAlign: 'center',
                  }}
                >
                  {index + 1}
                </Typography>
              </ListItemIcon>
              <ListItemIcon sx={{ minWidth: 32 }}>
                <ItemIcon type={entityType} size="small" />
              </ListItemIcon>
              <ListItemText
                primary={name}
                secondary={entity.x_opencti_main_observable_type ?? entityType}
                slotProps={{
                  primary: {
                    sx: {
                      fontSize: '0.825rem',
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    },
                  },
                  secondary: { sx: { fontSize: '0.7rem' } },
                }}
              />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 1, flexShrink: 0 }}>
                {score !== undefined && score !== null && (
                  <Chip
                    label={score}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      backgroundColor: score >= 70
                        ? theme.palette.error.main + '20'
                        : score >= 40
                          ? theme.palette.warning.main + '20'
                          : theme.palette.success.main + '20',
                      color: score >= 70
                        ? theme.palette.error.main
                        : score >= 40
                          ? theme.palette.warning.main
                          : theme.palette.success.main,
                    }}
                  />
                )}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, minWidth: 50 }}>
                  <VisibilityOutlined sx={{ fontSize: 14, color: theme.palette.text.secondary }} />
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 600,
                      color: theme.palette.text.primary,
                      fontSize: '0.8rem',
                    }}
                  >
                    {sightingCount}
                  </Typography>
                </Box>
              </Box>
            </ListItemButton>
          </ListItem>
        );
      })}
    </List>
  );
};

interface TrendingIndicatorsProps {
  title?: string;
  height?: number;
  days?: number;
}

const TrendingIndicators: React.FC<TrendingIndicatorsProps> = ({
  title,
  height = 400,
  days = 7,
}) => {
  const theme = useTheme<Theme>();
  const { t_i18n } = useFormatter();

  const now = new Date();
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const endDate = now.toISOString();

  const queryRef = useQueryLoading<TrendingIndicatorsQuery>(trendingIndicatorsQuery, {
    field: 'internal_id',
    operation: 'count',
    startDate,
    endDate,
    limit: 10,
    order: 'desc',
    fromTypes: ['Indicator'],
  });

  return (
    <Card
      variant="outlined"
      sx={{
        height,
        borderRadius: 1.5,
        border: `1px solid ${theme.palette.divider}`,
      }}
    >
      <CardHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TrendingUpOutlined sx={{ fontSize: 20, color: theme.palette.primary.main }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '0.9rem' }}>
              {title ?? t_i18n('Trending indicators (Last 7 days)')}
            </Typography>
          </Box>
        }
        sx={{ pb: 0, pt: 1.5, px: 2 }}
      />
      <CardContent sx={{ pt: 1, pb: 1, px: 1, '&:last-child': { pb: 1 } }}>
        {queryRef ? (
          <React.Suspense fallback={<Loader variant={LoaderVariant.inElement} />}>
            <TrendingIndicatorsComponent queryRef={queryRef} height={height} />
          </React.Suspense>
        ) : (
          <Loader variant={LoaderVariant.inElement} />
        )}
      </CardContent>
    </Card>
  );
};

export default TrendingIndicators;
