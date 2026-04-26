export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export type IngredientAnalysis = {
  name: string;
  calories: number;
};

export type MealAnalysis = {
  mealName: string;
  ingredients: IngredientAnalysis[];
  totalCalories: number;
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
