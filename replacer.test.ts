import { Project } from "ts-morph";
import { BranchReplacer } from "./replacer";

function createProjectWithSource(sourceText: string): Project {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      target: 3,
      module: 1,
      jsx: 2,
    },
  });
  project.createSourceFile("test.tsx", sourceText);
  return project;
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

describe("BranchReplacer.replaceUseValueBranchesWithKey - all conditions", () => {
  const key = "role";

  test.each([
    // simple boolean
    [
      "if with boolean true",
      `import { useValue } from "@some-library";
       const result = useValue("role");
       if (result) doA(); else doB();`,
      true,
      `import { useValue } from "@some-library";
       doA();`,
    ],

    // string equality
    [
      "if result === 'admin'",
      `import { useValue } from "@some-library";
       const result = useValue("role");
       if (result === "admin") doA(); else doB();`,
      "admin",
      `import { useValue } from "@some-library";
       doA();`,
    ],

    // logical && and ||
    [
      "complex condition with && and ||",
      `import { useValue } from "@some-library";
       const result = useValue("role");
       if ((result === "admin" && isAdmin()) || (result === "guest" && isGuest())) doX(); else doY();`,
      "admin",
      `import { useValue } from "@some-library";
       if (isAdmin()) doX(); else doY();`,
    ],

    // ternary
    [
      "ternary with ===",
      `import { useValue } from "@some-library";
       const result = useValue("role");
       const label = result === "admin" ? "adminLabel" : "userLabel";`,
      "admin",
      `import { useValue } from "@some-library";
       const label = "adminLabel";`,
    ],

    // negation
    [
      "if with !result",
      `import { useValue } from "@some-library";
      const result = useValue("role");
      if (!result) doFalse(); else doTrue();`,
      false,
      `import { useValue } from "@some-library";
      doFalse();`,
    ],

    // result removal
    [
      "declaration removed after replacement",
      `import { useValue } from "@some-library";
      const result = useValue("role");
      if (result === "admin") doAdmin(); else doGuest();`,
      "admin",
      `import { useValue } from "@some-library";
      doAdmin();`,
    ],
  ])("%s", (_, source, expectedValue, expectedOutput) => {
    const project = createProjectWithSource(source);
    const replacer = new BranchReplacer(project, {[key]: expectedValue});
    replacer.replaceUseValueBranchesWithKey(key);

    const resultText = project.getSourceFiles()[0].getFullText();
    expect(normalizeText(resultText)).toBe(normalizeText(expectedOutput));
  });
});
