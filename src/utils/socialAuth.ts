import {
  signInWithPopup,
  GoogleAuthProvider,
  FacebookAuthProvider,
  type AuthProvider,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore/lite";
import { auth, db } from "../firebase.js";

/** Fields that come from social providers and are always safe to overwrite. */
interface SocialUserFields {
  uid: string;
  email: string | null;
  username: string;
  displayName: string;
  photoURL: string | null;
  authProvider: string;
  updatedAt: ReturnType<typeof serverTimestamp>;
}

/**
 * Returns true when the user has completed the personal-details step.
 * Used to decide where to navigate after social sign-in.
 */
function hasPersonalDetails(data: Record<string, unknown>): boolean {
  return !!(data.gender && data.birthDate && data.height && data.weight);
}

/**
 * Signs in with a popup using the given Firebase Auth provider.
 * - Creates a new Firestore document for first-time users (adds `createdAt`).
 * - Merges safe social fields without overwriting personal details.
 * @returns "/home" if the user already has personal details, "/details" otherwise.
 */
export async function signInWithSocialProvider(
  provider: AuthProvider
): Promise<"/home" | "/details"> {
  const result = await signInWithPopup(auth, provider);
  const user = result.user;

  const providerName =
    provider instanceof GoogleAuthProvider
      ? "google"
      : provider instanceof FacebookAuthProvider
      ? "facebook"
      : "unknown";

  const socialFields: SocialUserFields = {
    uid: user.uid,
    email: user.email,
    username: user.displayName ?? user.email ?? "",
    displayName: user.displayName ?? user.email ?? "",
    photoURL: user.photoURL,
    authProvider: providerName,
    updatedAt: serverTimestamp(),
  };

  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    // Brand-new user — write full doc including createdAt.
    await setDoc(userRef, {
      ...socialFields,
      createdAt: serverTimestamp(),
    });
    return "/details";
  }

  // Existing user — merge only the safe social fields, preserve personal details.
  await setDoc(userRef, socialFields, { merge: true });

  const data = userSnap.data() as Record<string, unknown>;
  return hasPersonalDetails(data) ? "/home" : "/details";
}

export const googleProvider = new GoogleAuthProvider();
export const facebookProvider = new FacebookAuthProvider();
