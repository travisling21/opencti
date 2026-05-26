import { graphql } from 'relay-runtime';
import { useFragment } from 'react-relay';
import { useTheme } from '@mui/styles';
import { LoginLogoFragment$key } from './__generated__/LoginLogoFragment.graphql';
import logoDark from '../../../static/images/argus_logo.png';
import logoLight from '../../../static/images/argus_logo.png';
import { isEmptyField } from '../../../utils/utils';
import { fileUri } from '../../../relay/environment';
import type { Theme } from '../../../components/Theme';

const fragment = graphql`
  fragment LoginLogoFragment on PublicSettings {
    platform_theme {
      theme_logo_login
    }
  }
`;

interface LoginLogoProps {
  data: LoginLogoFragment$key;
}

const LoginLogo = ({ data }: LoginLogoProps) => {
  const theme = useTheme<Theme>();
  const { platform_theme } = useFragment(fragment, data);
  let logo = platform_theme?.theme_logo_login;
  if (isEmptyField(logo)) {
    logo = fileUri(theme.palette.mode === 'dark' ? logoDark : logoLight);
  }

  return (
    <img
      src={logo}
      alt="Argus"
      style={{
        width: 220,
        display: 'block',
        margin: '0 auto',
        objectFit: 'contain',
      }}
    />
  );
};

export default LoginLogo;
