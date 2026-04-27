import {
  signInWithPopup,
  GoogleAuthProvider,
  FacebookAuthProvider,
  type AuthProvider,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore/lite";
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

type UserDocData = Record<string, unknown>;

export type SocialSignInResult = {
  user: User;
  isProfileComplete: boolean;
};

const PERSONAL_DETAIL_KEYS = [
  "gender",
  "birthDate",
  "height",
  "weight",
] as const;

/**
 * Returns true when the user has completed the personal-details step.
 * Used to decide where to navigate after social sign-in.
 */
function hasPersonalDetails(data: UserDocData): boolean {
  return !!(data.gender && data.birthDate && data.height && data.weight);
}

function hasUsefulValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return value !== undefined && value !== null;
}

function getMissingPersonalDetailsPatch(
  targetData: UserDocData | null,
  sourceData: UserDocData
): Partial<UserDocData> {
  const patch: Partial<UserDocData> = {};

  for (const key of PERSONAL_DETAIL_KEYS) {
    const targetValue = targetData?.[key];
    const sourceValue = sourceData[key];

    if (!hasUsefulValue(targetValue) && hasUsefulValue(sourceValue)) {
      patch[key] = sourceValue;
    }
  }

  return patch;
}

/**
 * Signs in with a popup using the given Firebase Auth provider.
 * - Creates a new Firestore document for first-time users (adds `createdAt`).
 * - Merges safe social fields without overwriting personal details.
 * @returns "/home" if the user already has personal details, "/details" otherwise.
 */
export async function signInWithSocialProvider(
  provider: AuthProvider
): Promise<SocialSignInResult> {
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

  try {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    const currentUserData = userSnap.exists()
      ? (userSnap.data() as UserDocData)
      : null;

    if (!userSnap.exists()) {
      // Brand-new user — write full doc including createdAt.
      await setDoc(userRef, {
        ...socialFields,
        createdAt: serverTimestamp(),
      });
    } else {
      // Existing user — merge only the safe social fields, preserve personal details.
      await setDoc(userRef, socialFields, { merge: true });
    }

    if (currentUserData && hasPersonalDetails(currentUserData)) {
      return { user, isProfileComplete: true };
    }

    if (user.email) {
      try {
        const usersRef = collection(db, "users");
        const sameEmailQuery = query(usersRef, where("email", "==", user.email));
        const sameEmailSnap = await getDocs(sameEmailQuery);

        const matchedProfileDoc = sameEmailSnap.docs.find((snap) => {
          if (snap.id === user.uid) return false;
          const data = snap.data() as UserDocData;
          return hasPersonalDetails(data);
        });

        if (matchedProfileDoc) {
          const matchedData = matchedProfileDoc.data() as UserDocData;
          const profilePatch = getMissingPersonalDetailsPatch(
            currentUserData,
            matchedData
          );

          if (Object.keys(profilePatch).length > 0) {
            await setDoc(userRef, profilePatch, { merge: true });
          }

          return { user, isProfileComplete: true };
        }
      } catch (queryError) {
        console.error("Social auth email lookup failed:", queryError);
      }
    }

    return { user, isProfileComplete: false };
  } catch (profileError) {
    console.error("Social auth profile sync failed:", profileError);
    // Login already succeeded; default to details to avoid leaving the user stuck.
    return { user, isProfileComplete: false };
  }
}

export async function signInWithGoogle(): Promise<SocialSignInResult> {
  return signInWithSocialProvider(googleProvider);
}

export const googleProvider = new GoogleAuthProvider();
export const facebookProvider = new FacebookAuthProvider();
