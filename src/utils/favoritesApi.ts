import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore/lite";
import { db } from "../firebase.js";
import type { FavoriteMeal, MealType, IngredientAnalysis } from "../types/mealAnalysis.js";

/**
 * Generates an analysisText string in the format expected by
 * NutritionJournalScreen's extractEstimatedCalories / extractMacro regex helpers.
 */
function buildAnalysisText(
  calories: number,
  protein?: number,
  carbs?: number,
  fat?: number,
): string {
  const lines = [`הערכה סבירה: ${calories}`];
  if (carbs != null) lines.push(`פחמימות: ${carbs}`);
  if (protein != null) lines.push(`חלבון: ${protein}`);
  if (fat != null) lines.push(`שומן: ${fat}`);
  return lines.join("\n");
}

export async function getFavorites(userId: string): Promise<FavoriteMeal[]> {
  const ref = collection(db, "users", userId, "favoriteMeals");
  const q = query(ref, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as FavoriteMeal[];
}

export async function addFavorite(
  userId: string,
  meal: Omit<FavoriteMeal, "id" | "createdAt" | "updatedAt">,
): Promise<string> {
  const ref = collection(db, "users", userId, "favoriteMeals");
  const docRef = await addDoc(ref, {
    ...meal,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function removeFavorite(userId: string, favoriteId: string): Promise<void> {
  const ref = doc(db, "users", userId, "favoriteMeals", favoriteId);
  await deleteDoc(ref);
}

/**
 * Copies a favourite meal into the user's daily diary (users/{uid}/meals).
 * Writes both structured numeric fields and a generated analysisText so that
 * NutritionJournalScreen can extract calories/macros via its regex helpers.
 */
export async function addFavoriteToDiary(
  userId: string,
  favorite: FavoriteMeal,
  mealType: MealType,
): Promise<void> {
  const ref = collection(db, "users", userId, "meals");
  const entry: Record<string, unknown> = {
    mealType,
    mealName: favorite.name,
    imageUrl: favorite.imageUrl ?? "",
    totalCalories: favorite.calories,
    ingredients: (favorite.ingredients ?? []) as IngredientAnalysis[],
    analysisText: buildAnalysisText(
      favorite.calories,
      favorite.protein,
      favorite.carbs,
      favorite.fat,
    ),
    createdAt: serverTimestamp(),
  };
  if (favorite.protein != null) entry.protein = favorite.protein;
  if (favorite.carbs != null) entry.carbs = favorite.carbs;
  if (favorite.fat != null) entry.fat = favorite.fat;
  await addDoc(ref, entry);
}
