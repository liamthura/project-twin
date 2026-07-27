import { beforeAll } from "vitest";
import { setProjectAnnotations } from "@storybook/react-vite";
import * as previewAnnotations from "./preview.js";

// Applies the same decorators, parameters and global styles the Storybook UI
// uses, so a story under test renders exactly as it does in the browser.
const project = setProjectAnnotations([previewAnnotations.default]);

beforeAll(project.beforeAll);
