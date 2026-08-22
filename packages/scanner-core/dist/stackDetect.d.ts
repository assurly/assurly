export type DetectedFramework = 'nextjs' | 'unknown';
export type DetectedDatabase = 'supabase' | 'prisma' | 'none';
export type DetectedPayments = 'stripe' | 'none';
export type DetectedDeployment = 'vercel' | 'unknown';
export interface DetectedStack {
    framework: DetectedFramework;
    database: DetectedDatabase;
    payments: DetectedPayments;
    deployment: DetectedDeployment;
}
export interface PackageManifestInput {
    path: string;
    content: string;
}
export interface DetectStackFromManifestsInput {
    manifests: readonly PackageManifestInput[];
    filePaths?: readonly string[];
}
/** Cap nested-manifest fetches in the browser Instant Gate. */
export declare const MAX_PACKAGE_MANIFESTS = 8;
/**
 * Nested workspace manifests, shallowest first, excluding `node_modules`.
 */
export declare function selectPackageManifestPaths(filePaths: readonly string[], limit?: number): string[];
/**
 * Merge every workspace `package.json` the same way the CLI detector does.
 * A root-only read reports unknown/none on monorepos whose deps live in `web/`
 * or `apps/web/`.
 */
export declare function detectStackFromManifests(input: DetectStackFromManifestsInput): DetectedStack;
export declare function describeDetectedStack(stack: DetectedStack): {
    framework: string;
    supabase: 'Detected' | 'Not Detected';
    stripe: 'Detected' | 'Not Detected';
};
