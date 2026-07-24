import {
  Check,
  Clock,
  Copy,
  CreditCard,
  DatabaseZap,
  Feather,
  Folder,
  Layers,
  Lightbulb,
  Lock,
  Mail,
  MonitorCheck,
  Search,
  ShieldCheck,
  Star,
  Timer,
  Wrench,
  X,
  type LucideProps,
} from 'lucide-react';
import type { ReactElement } from 'react';

const BASE_CLASS = 'home-icon';
const DEFAULT_STROKE_WIDTH = 1.75;

function mergeIconClass(className?: string): string {
  return [BASE_CLASS, className].filter(Boolean).join(' ');
}

export function HomeCheckIcon({
  className,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  ...props
}: LucideProps): ReactElement {
  return (
    <Check
      aria-hidden="true"
      className={mergeIconClass(className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export function HomeClockIcon({
  className,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  ...props
}: LucideProps): ReactElement {
  return (
    <Clock
      aria-hidden="true"
      className={mergeIconClass(className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export function HomeCopyIcon({
  className,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  ...props
}: LucideProps): ReactElement {
  return (
    <Copy
      aria-hidden="true"
      className={mergeIconClass(className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export function HomeCreditCardIcon({
  className,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  ...props
}: LucideProps): ReactElement {
  return (
    <CreditCard
      aria-hidden="true"
      className={mergeIconClass(className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export function HomeDatabaseZapIcon({
  className,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  ...props
}: LucideProps): ReactElement {
  return (
    <DatabaseZap
      aria-hidden="true"
      className={mergeIconClass(className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export function HomeFeatherIcon({
  className,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  ...props
}: LucideProps): ReactElement {
  return (
    <Feather
      aria-hidden="true"
      className={mergeIconClass(className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export function HomeFolderIcon({
  className,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  ...props
}: LucideProps): ReactElement {
  return (
    <Folder
      aria-hidden="true"
      className={mergeIconClass(className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export function HomeLayersIcon({
  className,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  ...props
}: LucideProps): ReactElement {
  return (
    <Layers
      aria-hidden="true"
      className={mergeIconClass(className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export function HomeLightbulbIcon({
  className,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  ...props
}: LucideProps): ReactElement {
  return (
    <Lightbulb
      aria-hidden="true"
      className={mergeIconClass(className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export function HomeLockIcon({
  className,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  ...props
}: LucideProps): ReactElement {
  return (
    <Lock
      aria-hidden="true"
      className={mergeIconClass(className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export function HomeMailIcon({
  className,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  ...props
}: LucideProps): ReactElement {
  return (
    <Mail
      aria-hidden="true"
      className={mergeIconClass(className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export function HomeMonitorCheckIcon({
  className,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  ...props
}: LucideProps): ReactElement {
  return (
    <MonitorCheck
      aria-hidden="true"
      className={mergeIconClass(className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export function HomeSearchIcon({
  className,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  ...props
}: LucideProps): ReactElement {
  return (
    <Search
      aria-hidden="true"
      className={mergeIconClass(className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export function HomeShieldCheckIcon({
  className,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  ...props
}: LucideProps): ReactElement {
  return (
    <ShieldCheck
      aria-hidden="true"
      className={mergeIconClass(className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export function HomeStarIcon({
  className,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  ...props
}: LucideProps): ReactElement {
  return (
    <Star
      aria-hidden="true"
      className={mergeIconClass(className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export function HomeTimerIcon({
  className,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  ...props
}: LucideProps): ReactElement {
  return (
    <Timer
      aria-hidden="true"
      className={mergeIconClass(className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export function HomeWrenchIcon({
  className,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  ...props
}: LucideProps): ReactElement {
  return (
    <Wrench
      aria-hidden="true"
      className={mergeIconClass(className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export function HomeXIcon({
  className,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  ...props
}: LucideProps): ReactElement {
  return (
    <X
      aria-hidden="true"
      className={mergeIconClass(className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}
