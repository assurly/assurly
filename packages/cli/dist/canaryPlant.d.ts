export interface PlantCanaryCliOptions {
    projectPath: string;
    repo: string;
    apiKey: string;
    apiBaseUrl: string;
    fetchImpl?: typeof fetch;
}
export declare function plantCanaryLocally(options: PlantCanaryCliOptions): Promise<{
    envPath: string;
    changed: boolean;
    callbackUrl?: string;
}>;
