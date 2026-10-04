import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  // 相对路径 base：适配 GitHub Pages 任意子路径部署（用户名.github.io/仓库名/），
  // 也支持本地直接打开 dist/index.html；若仓库名固定为 XXX，可改为 base: "/XXX/"
  base: "./",
  // 游戏海报静态目录：以 <base>/<文件名>.png 访问
  publicDir: "GamePosters",
});
