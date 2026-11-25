import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import { IPC, type SubxApi } from "../shared/ipc";

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: SubxApi = {
  os: "mac",
  auth: {
    state: () => ipcRenderer.invoke(IPC.authState),
    signInWithGoogle: (options) => ipcRenderer.invoke(IPC.authGoogle, options),
    startEmail: (email) => ipcRenderer.invoke(IPC.authStartEmail, email),
    verifyCode: (code) => ipcRenderer.invoke(IPC.authVerifyCode, code),
    resendEmailCode: () => ipcRenderer.invoke(IPC.authResendEmailCode),
    deleteAccount: () => ipcRenderer.invoke(IPC.authDeleteAccount),
    signOut: () => ipcRenderer.invoke(IPC.authSignOut),
    setProfile: (name) => ipcRenderer.invoke(IPC.authSetProfile, name),
    usage: () => ipcRenderer.invoke(IPC.authUsage),
    devices: () => ipcRenderer.invoke(IPC.accountDevices),
    onChanged: (listener) => subscribe(IPC.authChanged, listener),
    accounts: () => ipcRenderer.invoke(IPC.authAccounts),
    switchTo: (id) => ipcRenderer.invoke(IPC.authSwitch, id),
    addAccount: () => ipcRenderer.invoke(IPC.authAddAccount),
  },
  team: {
    get: () => ipcRenderer.invoke(IPC.teamGet),
    save: (name) => ipcRenderer.invoke(IPC.teamSave, name),
    invite: (email, admin) => ipcRenderer.invoke(IPC.teamInvite, email, admin === true),
    remove: (email) => ipcRenderer.invoke(IPC.teamRemove, email),
    words: (change) => ipcRenderer.invoke(IPC.teamWords, change),
    leave: () => ipcRenderer.invoke(IPC.teamLeave),
  },
  billing: {
    get: () => ipcRenderer.invoke(IPC.billingGet),
    checkout: (choice) => ipcRenderer.invoke(IPC.billingCheckout, choice),
    portal: () => ipcRenderer.invoke(IPC.billingPortal),
    seatsQuote: (add) => ipcRenderer.invoke(IPC.billingSeatsQuote, add),
    addSeats: (add) => ipcRenderer.invoke(IPC.billingSeatsBuy, add),
  },
  voice: {
    settings: () => ipcRenderer.invoke(IPC.voiceSettingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.voiceSettingsSet, patch),
    languages: () => ipcRenderer.invoke(IPC.voiceLanguages),
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    openRecordingsFolder: () => ipcRenderer.invoke(IPC.openRecordingsFolder),
    onNavigate: (listener) => subscribe(IPC.navigate, listener),
  },
  update: {
    state: () => ipcRenderer.invoke(IPC.updateState),
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    install: () => ipcRenderer.send(IPC.updateInstall),
    onChanged: (listener) => subscribe(IPC.updateChanged, listener),
  },
  permissions: {
    list: () => ipcRenderer.invoke(IPC.permissionList),
    request: (kind) => ipcRenderer.invoke(IPC.permissionRequest, kind),
    openSettings: (kind) => ipcRenderer.invoke(IPC.permissionOpenSettings, kind),
    restartApp: () => ipcRenderer.invoke(IPC.appRestart),
  },
  history: {
    list: () => ipcRenderer.invoke(IPC.historyList),
    audio: (id) => ipcRenderer.invoke(IPC.historyAudio, id),
    remove: (id) => ipcRenderer.invoke(IPC.historyRemove, id),
    clear: () => ipcRenderer.invoke(IPC.historyClear),
    onChanged: (listener) => subscribe(IPC.historyChanged, listener),
  },
  stats: {
    days: () => ipcRenderer.invoke(IPC.statsDays),
    onChanged: (listener) => subscribe(IPC.statsChanged, listener),
  },
  dictionary: {
    list: () => ipcRenderer.invoke(IPC.dictionaryList),
    onChanged: (listener) => subscribe(IPC.dictionaryChanged, listener),
    upsert: (entry) => ipcRenderer.invoke(IPC.dictionaryUpsert, entry),
    remove: (word) => ipcRenderer.invoke(IPC.dictionaryRemove, word),
    learning: () => ipcRenderer.invoke(IPC.dictionaryLearning),
    acceptPending: (key) => ipcRenderer.invoke(IPC.dictionaryAcceptPending, key),
    dropPending: (key) => ipcRenderer.invoke(IPC.dictionaryDropPending, key),
    allowAgain: (word) => ipcRenderer.invoke(IPC.dictionaryAllowAgain, word),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (settings) => ipcRenderer.invoke(IPC.settingsSet, settings),
    onChanged: (listener) => subscribe(IPC.settingsChanged, listener),
    publishMicrophones: (options) => ipcRenderer.send(IPC.microphonePublish, options),
    microphones: () => ipcRenderer.invoke(IPC.microphoneList),
  },
  hotkey: {
    record: () => ipcRenderer.invoke(IPC.hotkeyRecord),
    cancelRecord: () => ipcRenderer.send(IPC.hotkeyRecordCancel),
    onHeld: (listener) => subscribe(IPC.hotkeyHeld, listener),
  },
  mic: {
    devices: () => ipcRenderer.invoke(IPC.micDevices),
    meter: (on) => ipcRenderer.send(IPC.micMeter, on),
    onLevel: (listener) => subscribe(IPC.micMeterLevel, listener),
  },
  pill: {
    onState: (listener) => subscribe(IPC.pillState, listener),
    onLevel: (listener) => subscribe(IPC.pillLevel, listener),
    onMicCommand: (listener) => subscribe(IPC.micCommand, listener),
    hover: (inside) => ipcRenderer.send(IPC.pillHover, inside),
    press: () => ipcRenderer.send(IPC.pillPress),
    release: () => ipcRenderer.send(IPC.pillRelease),
    onHoverReset: (listener) => subscribe(IPC.pillHoverReset, listener),
    area: (rect) => ipcRenderer.send(IPC.pillArea, rect),
    demo: (state) => ipcRenderer.send(IPC.pillDemo, state),
    sendChunk: (samples) => ipcRenderer.send(IPC.micChunk, samples),
    micStopped: () => ipcRenderer.send(IPC.micStopped),
    micError: (message) => ipcRenderer.send(IPC.micError, message),
  },
};

contextBridge.exposeInMainWorld("subx", api);
