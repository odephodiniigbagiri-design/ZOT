
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  appType: "mpa",
  build: {
    rollupOptions: {
      input: {
        home: resolve(root, "index.html"),
        register: resolve(root, "register.html"),
        attend: resolve(root, "attend.html"),
        studentLogin: resolve(root, "student-login.html"),
        studentDashboard: resolve(root, "student-dashboard.html"),
        admin: resolve(root, "admin.html"),
        adminDashboard: resolve(root, "admin-dashboard.html"),
        affiliate: resolve(root, "affiliate.html"),
        affiliateDashboard: resolve(root, "affiliate-dashboard.html"),
        mocks: resolve(root, "mocks.html"),
        mockExam: resolve(root, "mock-exam.html"),
        mockReview: resolve(root, "mock-review.html"),
        adminMocks: resolve(root, "admin-mocks.html"),
      },
    },
  },
});
