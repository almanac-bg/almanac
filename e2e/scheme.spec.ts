import { expect, test } from "@playwright/test";

// The device says Day; the player chooses Night, then Day, then the device's again („Изглед“ in Настройки), and the
// choice holds over a reload.
test.use({ colorScheme: "light" });

test("Night or Day, whatever the device says", async ({ page }) => {
  const ground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.goto("/settings");
  const look = page.getByRole("radiogroup", { name: "Изглед" });
  await expect(look.getByRole("radio", { name: "Автоматично" })).toHaveAttribute("aria-checked", "true");
  expect(await ground()).toBe("rgb(245, 243, 250)");

  await look.getByRole("radio", { name: "Нощ" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "night");
  expect(await ground()).toBe("rgb(17, 12, 32)");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "night");
  await expect(page.getByRole("radiogroup", { name: "Изглед" }).getByRole("radio", { name: "Нощ" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(await ground()).toBe("rgb(17, 12, 32)");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("radiogroup", { name: "Изглед" }).getByRole("radio", { name: "Ден" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "day");
  expect(await ground()).toBe("rgb(245, 243, 250)");

  await page.getByRole("radiogroup", { name: "Изглед" }).getByRole("radio", { name: "Автоматично" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-scheme");
  expect(await ground()).toBe("rgb(17, 12, 32)");
});
