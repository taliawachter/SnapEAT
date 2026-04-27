export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export type IngredientAnalysis = {
  name: string;
  calories: number;
  quantity?: string;
  protein?: number;
  carbs?: number;
  fat?: number;
};

export type MealAnalysis = {
  mealName: string;
  ingredients: IngredientAnalysis[];
  totalCalories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  confidence?: number;
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
