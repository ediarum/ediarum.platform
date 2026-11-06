/**
 * All user-facing text of the platform. Keep every string here so a second language can be
 * added later by providing another object of type `Strings`.
 */
export const strings = {
  productName: 'ediarum',
  nav: {
    apps: 'Applications',
    noApps: 'No applications',
    skipToContent: 'Skip to content',
    userMenu: 'User menu',
    profile: 'Profile',
    logout: 'Log out',
  },
  login: {
    title: 'Log in',
    email: 'Email',
    password: 'Password',
    submit: 'Log in',
    submitting: 'Logging in…',
    failed: 'Email or password is incorrect.',
    sessionExpired: 'Your session has ended. Please log in again.',
  },
  profile: {
    title: 'Profile',
    name: 'Name',
    roles: 'Roles',
    noRoles: 'none',
    projects: 'Projects',
    noProjects: 'none',
    allProjects: 'all projects (administrator)',
    saveName: 'Save name',
    nameSaved: 'Your name has been saved.',
    nameRequired: 'Please enter a name.',
    email: 'Email',
    emailFixed: 'Identifies your account; it cannot be changed.',
    changePassword: 'Change password',
    currentPassword: 'Current password',
    newPassword: 'New password',
    repeatPassword: 'Repeat new password',
    submit: 'Change password',
    submitting: 'Saving…',
    mismatch: 'The new passwords do not match.',
    changed: 'Your password has been changed.',
  },
  app: {
    loading: (label: string) => `Loading ${label}…`,
    unavailable: (label: string) => `${label} is currently unavailable.`,
    incompatible: (label: string, got: string, expected: number) =>
      `${label} is incompatible with this platform version (contract ${got}, expected ${expected}).`,
    invalidModule: (label: string) => `${label} could not be started: its module does not export a mount function.`,
    mountFailed: (label: string) => `${label} failed to start.`,
    retry: 'Retry',
  },
  noAccess: {
    title: 'No access',
    text: (label: string) => `You do not have access to ${label}.`,
  },
  notFound: {
    title: 'Page not found',
    text: 'There is nothing at this address.',
    home: 'Go to start page',
  },
  config: {
    title: 'The platform could not start',
    text: 'The application configuration (config/apps.json) is missing or invalid. Please contact the administrators.',
    details: 'Details',
  },
  errors: {
    generic: 'Something went wrong. Please try again.',
    network: 'The server could not be reached. Please try again.',
  },
}

export type Strings = typeof strings
