module.exports = {
  "presets": [
    [
      "@babel/preset-env",
      {
        useBuiltIns: "usage",
        corejs: "3.24.1"
      }
    ]
  ],
  "plugins": [
      ["@babel/transform-runtime"]
  ]
}
