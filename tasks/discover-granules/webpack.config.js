const path = require('path');
// path to module root
const root = path.resolve(__dirname);

const ignoredPackages = [
  'cpu-features'
];

module.exports = {
  plugins: [
    new IgnorePlugin(new RegExp(`^(${ignoredPackages.join('|')})$`)),
  ],
  mode: process.env.PRODUCTION ? 'production' : 'development',
  entry: './index.js',
  output: {
    libraryTarget: 'commonjs2',
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist'),
    devtoolModuleFilenameTemplate: (info) => {
      const relativePath = path.relative(root, info.absoluteResourcePath)
      return `webpack://${relativePath}`;
    }
  },
  externals: [
    'aws-sdk',
    'electron',
    {'formidable': 'url'}
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              cacheDirectory: true
            },
          },
        ],
      },
      {
        test: /\.node$/,
        loader: "node-loader",
      },
    ],
  },
  devtool: 'inline-source-map',
  target: 'node',
  optimization: {
    nodeEnv: false
  }
};
