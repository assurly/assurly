export interface RuleExplanation {
    ruleId: string;
    title: string;
    explanation: string;
    howToFix: string;
    blocksShip: boolean;
}
export declare function explainRule(ruleId: string): RuleExplanation | null;
