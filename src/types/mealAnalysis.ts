export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export type IngredientAnalysis = {
  name: string;
  estimatedQuantity?: string | null;
  estimatedQuantityGrams?: number | null;
  calories?: number | null;
  proteinGrams?: number | null;
  carbohydratesGrams?: number | null;
  fatGrams?: number | null;
  confidence?: number;
  quantity?: string;
  grams?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
};

export type MealAnalysis = {
  mealName: string;
  description?: string;
  totalEstimatedQuantityGrams?: number | null;
  ingredients: IngredientAnalysis[];
  totalCalories: number;
  totalProteinGrams?: number;
  totalCarbohydratesGrams?: number;
  totalFatGrams?: number;
  confidence?: number;
  estimationNotes?: string[];
  protein?: number;
  carbs?: number;
  fat?: number;
};

export type AnalyzeMealResponse = {
  imageUrl: string;
  analysis: MealAnalysis;
};

export type SaveDiaryMealPayload = {
  userId: string;
  mealType: MealType;
  mealName: string;
  imageUrl: string;
  ingredients: IngredientAnalysis[];
  totalCalories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  date: string;
};

export type FavoriteMeal = {
  id: string;
  name: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  imageUrl?: string;
  source?: "saved_from_meal" | "manual";
  ingredients?: IngredientAnalysis[];
  createdAt?: unknown;
  updatedAt?: unknown;
};
