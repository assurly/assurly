/**
 * Creates the .github/workflows/shipready.yml file inside target directory.
 */
export declare function setupGitHubAction(targetPath: string): {
    success: boolean;
    message: string;
    filePath?: string;
};
