import { Navigate, Route, Routes } from "react-router";
import SplashScreen from "./pages/SplashScreen.js";
import WelcomeScreen from "./pages/WelcomeScreen.js";
import HelloScreen from "./pages/HelloScreen.js";  
import LoginScreen from "./pages/LoginScreen.js";
import SignupScreen from "./pages/SignupScreen.js";
import PersonalDetailsScreen from "./pages/PersonalDetailsScreen.js"; 
import NutritionJournalScreen from "./pages/NutritionJournalScreen.js";
import MealCategoryScreen from "./pages/MealCategoryScreen.js";
import MyMealsScreen from "./pages/MyMealsScreen.js";
import MealAnalysisResultScreen from "./pages/MealAnalysisResultScreen.js";
import FavoriteMealsScreen from "./pages/FavoriteMealsScreen.js";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/splash" replace />} />
      <Route path="/splash" element={<SplashScreen />} />
      <Route path="/welcome" element={<WelcomeScreen />} />
      <Route path="/hello" element={<HelloScreen />} />
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/signup" element={<SignupScreen />} />
      <Route path="/details" element={<PersonalDetailsScreen />} />
      <Route path="/home" element={<NutritionJournalScreen />} />
      <Route path="/meal/:mealType" element={<MealCategoryScreen />} />
      <Route path="/my-meals" element={<MyMealsScreen />} />
      <Route path="/meal-analysis-result" element={<MealAnalysisResultScreen />} />
      <Route path="/favorites" element={<FavoriteMealsScreen />} />
    </Routes>
  );
}