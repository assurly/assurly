import {
  Archive,
  Building2,
  Folder,
  Lock,
  Rocket,
  Search,
  Settings,
  Zap,
  type LucideProps,
} from 'lucide-react';
import type { ReactElement } from 'react';

const BASE_CLASS = 'dashboard-icon';

function mergeIconClass(className?: string): string {
  return [BASE_CLASS, className].filter(Boolean).join(' ');
}

export function DashboardFolderIcon({ className, ...props }: LucideProps): ReactElement {
  return <Folder aria-hidden="true" className={mergeIconClass(className)} {...props} />;
}

export function DashboardArchiveIcon({ className, ...props }: LucideProps): ReactElement {
  return <Archive aria-hidden="true" className={mergeIconClass(className)} {...props} />;
}

export function DashboardZapIcon({ className, ...props }: LucideProps): ReactElement {
  return <Zap aria-hidden="true" className={mergeIconClass(className)} {...props} />;
}

export function DashboardBuildingIcon({ className, ...props }: LucideProps): ReactElement {
  return <Building2 aria-hidden="true" className={mergeIconClass(className)} {...props} />;
}

export function DashboardSearchIcon({ className, ...props }: LucideProps): ReactElement {
  return <Search aria-hidden="true" className={mergeIconClass(className)} {...props} />;
}

export function DashboardSettingsIcon({ className, ...props }: LucideProps): ReactElement {
  return <Settings aria-hidden="true" className={mergeIconClass(className)} {...props} />;
}

export function DashboardRocketIcon({ className, ...props }: LucideProps): ReactElement {
  return <Rocket aria-hidden="true" className={mergeIconClass(className)} {...props} />;
}

export function DashboardLockIcon({ className, ...props }: LucideProps): ReactElement {
  return <Lock aria-hidden="true" className={mergeIconClass(className)} {...props} />;
}
