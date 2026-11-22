import { expect, test } from "@playwright/test";

// The device says Day; the player chooses Night, then Day, then the device's again („Изглед“ in Настройки), and the
// choice holds over a reload and on the pages the server draws alone.
test.use({ colorScheme: "light" });

test("Night or Day, whatever the device says", async ({ page }) => {
  const ground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.goto("/settings");
  const look = page.getByRole("radiogroup", { name: "Изглед" });
  await expect(look.getByRole("radio", { name: "Като устройството" })).toHaveAttribute("aria-checked", "true");
  expect(await ground()).toBe("rgb(243, 244, 250)");

  await look.getByRole("radio", { name: "Нощ" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "night");
  expect(await ground()).toBe("rgb(14, 12, 29)");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "night");
  await expect(page.getByRole("radiogroup", { name: "Изглед" }).getByRole("radio", { name: "Нощ" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(await ground()).toBe("rgb(14, 12, 29)");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("radiogroup", { name: "Изглед" }).getByRole("radio", { name: "Ден" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "day");
  expect(await ground()).toBe("rgb(243, 244, 250)");

  // The pages the server draws alone (the privacy notice) look as chosen too, not as the device is set.
  await page.goto("/privacy");
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "day");
  expect(await ground()).toBe("rgb(243, 244, 250)");
  await page.goBack();

  await page.getByRole("radiogroup", { name: "Изглед" }).getByRole("radio", { name: "Като устройството" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-scheme");
  expect(await ground()).toBe("rgb(14, 12, 29)");
});
