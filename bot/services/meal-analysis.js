export async function analyzeMealImage(imagePath) {
  // Placeholder implementation. Replace with real AI vision integration later.
  return {
    mealName: "יוגורט עם אוכמניות",
    ingredients: [
      { name: "יוגורט פרו 0% שומן", calories: 116 },
      { name: "אוכמניות", calories: 30 },
      { name: "דבש", calories: 29 },
    ],
    totalCalories: 175,
    protein: 16,
    carbs: 22,
    fat: 0,
    sourceImagePath: imagePath,
  };
}
