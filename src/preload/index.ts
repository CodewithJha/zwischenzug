import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('zz', { version: '0.1.0' });
