// Shared auth sessions must match the selected account; local storage is not a role authority.
export async function readSessionIdentity(user, expectedName) {
    if (!user || !expectedName) return null;
    const { claims } = await user.getIdTokenResult();
    if (claims.name !== expectedName) return null;
    return { name: claims.name, isCoach: claims.isCoach === true };
}
