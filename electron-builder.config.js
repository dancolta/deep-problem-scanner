module.exports = {
  appId: "com.nodesparks.deep-problem-scanner",
  productName: "Deep Problem Scanner",
  directories: {
    output: "build"
  },
  files: [
    "dist/**/*",
    "package.json"
  ],
  mac: {
    target: "dmg",
    category: "public.app-category.developer-tools"
  },
  win: {
    target: "nsis"
  },
  linux: {
    target: "AppImage"
  },
  extraResources: [
    {
      from: "node_modules/puppeteer/.local-chromium",
      to: "chromium",
      filter: ["**/*"]
    }
  ]
};
