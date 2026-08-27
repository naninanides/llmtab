# llmtab-desktop

Menu-bar / tray app for [LLMTab](https://github.com/naninanides/llmtab-v2).

This package is a thin launcher. All the application code lives in the
[`llmtab`](https://www.npmjs.com/package/llmtab) package; `llmtab-desktop`
only adds the Electron runtime, which is ~200 MB and therefore not something
to force on people who just want the CLI.

## Install

```sh
npm i -g llmtab-desktop     # tray app  (pulls llmtab + electron)
llmtab-desktop
```

To get the `llmtab` CLI command on your PATH as well, install both — npm only
links the bins of the package you name:

```sh
npm i -g llmtab llmtab-desktop
```

## Platform support

| OS      | status                                                         |
| ------- | -------------------------------------------------------------- |
| macOS   | supported — template-image tray icon, popover under the icon   |
| Linux   | runs, untested; tray appearance depends on your desktop's tray |
| Windows | runs, untested; tray appearance not tuned                      |

The shell uses macOS tray idioms (`setTemplateImage`, popover positioning
relative to the menu-bar item). It should start on Linux and Windows but is
not yet tuned for them. Bug reports with screenshots are welcome.

If you only need the dashboard, `npm i -g llmtab` and run `llmtab` — it serves
the same UI in your browser with no Electron dependency.

## Uninstall

```sh
npm rm -g llmtab-desktop
llmtab uninstall            # optional: also remove ~/.llmtab data
```

## License

MIT
