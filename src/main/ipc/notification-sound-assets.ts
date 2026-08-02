import beepSoundPath from '../../../resources/notification-sounds/beep.mp3?asset'
import blipSoundPath from '../../../resources/notification-sounds/blip.mp3?asset'
import blopSoundPath from '../../../resources/notification-sounds/blop.mp3?asset'
import bongSoundPath from '../../../resources/notification-sounds/bong.mp3?asset'
import clackSoundPath from '../../../resources/notification-sounds/clack.mp3?asset'
import dingSoundPath from '../../../resources/notification-sounds/ding.mp3?asset'
import sonarSoundPath from '../../../resources/notification-sounds/sonar.mp3?asset'
import thumpSoundPath from '../../../resources/notification-sounds/thump.mp3?asset'
import twoToneSoundPath from '../../../resources/notification-sounds/two-tone.mp3?asset'

export const NOTIFICATION_SOUND_MIME_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  ['.ogg', 'audio/ogg'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.m4a', 'audio/mp4'],
  ['.aac', 'audio/aac'],
  ['.flac', 'audio/flac']
])

export const BUILT_IN_NOTIFICATION_SOUNDS: ReadonlyMap<string, string> = new Map([
  ['two-tone', twoToneSoundPath],
  ['bong', bongSoundPath],
  ['thump', thumpSoundPath],
  ['blip', blipSoundPath],
  ['sonar', sonarSoundPath],
  ['blop', blopSoundPath],
  ['ding', dingSoundPath],
  ['clack', clackSoundPath],
  ['beep', beepSoundPath]
])
