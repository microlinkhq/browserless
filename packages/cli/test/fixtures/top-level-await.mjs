const prefix = await Promise.resolve('awaited')

export default async ({ page }) => `${prefix} ${typeof page.goto}`
