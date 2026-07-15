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
