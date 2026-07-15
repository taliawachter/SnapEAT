declare module "../../shared/meal-analysis.js" {
  export type CanonicalIngredientAnalysis = {
    name: string;
    estimatedQuantity: string | null;
    estimatedQuantityGrams: number | null;
    calories: number | null;
    proteinGrams: number | null;
    carbohydratesGrams: number | null;
    fatGrams: number | null;
    confidence: number;
    quantity?: string | null;
    grams?: number | null;
    protein?: number | null;
    carbs?: number | null;
    fat?: number | null;
  };

  export type CanonicalMealAnalysis = {
    mealName: string;
    description: string;
    totalEstimatedQuantityGrams: number | null;
    totalCalories: number;
    totalProteinGrams: number;
    totalCarbohydratesGrams: number;
    totalFatGrams: number;
    confidence: number;
    estimationNotes: string[];
    ingredients: CanonicalIngredientAnalysis[];
    needsClarification?: boolean;
    clarificationQuestion?: string | null;
    protein?: number;
    carbs?: number;
    fat?: number;
  };

  export const UNKNOWN_QUANTITY_TEXT: string;
  export const UNKNOWN_ESTIMATE_TEXT: string;
  export function normalizeMealAnalysis(raw?: unknown): CanonicalMealAnalysis;
  export function mergeMissingMealAnalysisFields(baseAnalysis: unknown, repairAnalysis: unknown): CanonicalMealAnalysis;
  export function mealAnalysisNeedsClarification(analysis: unknown): boolean;
  export function mealAnalysisNeedsRepair(analysis: unknown): boolean;
  export function canonicalAnalysisToLegacyText(analysisInput: unknown): string;
  export function normalizeMealRecordForDisplay(meal?: unknown): CanonicalMealAnalysis;
  export function formatEstimatedQuantityDisplay(ingredient?: unknown): string;
  export function formatEstimatedNumericDisplay(value: unknown, suffix?: string): string;
}

declare module "../../shared/meal-edit.js" {
  export type MealEditIngredientDraft = {
    name: string;
    estimatedQuantity: string | null;
    calories: number | null;
    proteinGrams: number | null;
    carbohydratesGrams: number | null;
    fatGrams: number | null;
  };

  export type MealEditDraft = {
    mealName: string;
    mealType: "breakfast" | "lunch" | "dinner" | "snack";
    totalEstimatedQuantityGrams: number | null;
    totalCalories: number | null;
    totalProteinGrams: number | null;
    totalCarbohydratesGrams: number | null;
    totalFatGrams: number | null;
    ingredients: MealEditIngredientDraft[];
  };

  export function normalizeMealForEdit(meal?: unknown, fallbackMealName?: string, fallbackMealType?: string): MealEditDraft;
  export function calculateCaloriesFromMacros(input: {
    proteinGrams: number;
    carbohydratesGrams: number;
    fatGrams: number;
  }): number | null;
  export function recalculateTotalsFromIngredients(ingredients?: MealEditIngredientDraft[]): {
    totalCalories: number;
    totalProteinGrams: number;
    totalCarbohydratesGrams: number;
    totalFatGrams: number;
    hasAny: boolean;
  };
  export function getMacroMismatchWarning(draft: MealEditDraft): string | null;
  export function validateMealEditDraft(rawDraft: unknown): {
    ok: boolean;
    errors: string[];
    draft: MealEditDraft;
    mismatchWarning: string | null;
  };
  export function buildCanonicalMealUpdatePayload(validDraft: MealEditDraft): Record<string, unknown>;
  export function applyMealUpdateLocally<T extends { id?: string }>(entries: T[], mealId: string, updatedMeal: Record<string, unknown>): T[];
}
