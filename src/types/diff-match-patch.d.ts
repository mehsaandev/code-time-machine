// Type definitions for diff-match-patch
declare module 'diff-match-patch' {
    export class diff_match_patch {
        constructor();
        
        // Diff functions
        diff_main(text1: string, text2: string, opt_checklines?: boolean): Diff[];
        diff_cleanupSemantic(diffs: Diff[]): void;
        diff_cleanupEfficiency(diffs: Diff[]): void;
        diff_levenshtein(diffs: Diff[]): number;
        diff_prettyHtml(diffs: Diff[]): string;
        
        // Patch functions
        patch_make(text1: string, text2: string): Patch[];
        patch_make(diffs: Diff[]): Patch[];
        patch_make(text1: string, diffs: Diff[]): Patch[];
        patch_toText(patches: Patch[]): string;
        patch_fromText(textline: string): Patch[];
        patch_apply(patches: Patch[], text: string): [string, boolean[]];
        
        // Match functions
        match_main(text: string, pattern: string, loc: number): number;
        
        // Properties
        Diff_Timeout: number;
        Diff_EditCost: number;
        Match_Threshold: number;
        Match_Distance: number;
        Patch_DeleteThreshold: number;
        Patch_Margin: number;
        Match_MaxBits: number;
    }
    
    export type Diff = [number, string];
    
    export interface Patch {
        diffs: Diff[];
        start1: number;
        start2: number;
        length1: number;
        length2: number;
    }
    
    export const DIFF_DELETE: -1;
    export const DIFF_INSERT: 1;
    export const DIFF_EQUAL: 0;
}
