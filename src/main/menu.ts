import { app, Menu, type MenuItemConstructorOptions } from 'electron';

/**
 * Minimal application menu: App, Edit (text fields need the shortcuts), Window. Reload and
 * DevTools exist only in development builds. On macOS the bold first title comes from the
 * app bundle, so a dev run (stock Electron.app) still shows "Electron" there.
 */
export function installAppMenu(): void {
  const name = app.getName();
  const mac = process.platform === 'darwin';
  app.setAboutPanelOptions({ applicationName: name, applicationVersion: app.getVersion() });

  const template: MenuItemConstructorOptions[] = [
    {
      label: name,
      submenu: [
        { role: 'about', label: `About ${name}` },
        { type: 'separator' },
        ...(mac
          ? ([
              { role: 'hide', label: `Hide ${name}` },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
            ] as const)
          : []),
        { role: 'quit', label: `Quit ${name}` },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    ...(app.isPackaged ? [] : [{ role: 'viewMenu' } as const]),
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
