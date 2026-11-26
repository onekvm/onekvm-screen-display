import { getOps } from '@pocketjs/framework/host'
import { Image, type NodeMirror } from '@pocketjs/framework/vue-vapor/components'
import { watchEffect } from 'vue'
import type { HomeStatusSource } from '../shared/homeWidgets'
import { createStatusIconTextures, statusIconTextureBounds } from './statusIconTextures'

const textures = createStatusIconTextures({
  uploadTexture: (pixels, width, height, psm) => getOps().uploadTexture(pixels, width, height, psm),
  freeTexture: handle => getOps().freeTexture(handle),
})

/** One native image borrows the shared texture for its current source/color. */
export function StatusIcon(props: { source: HomeStatusSource; color: number; width: number; height: number }) {
  let node: NodeMirror | null = null
  let handle = -1
  watchEffect(onCleanup => {
    const texture = textures.acquire(props.source, props.color)
    handle = texture.handle
    if (node) getOps().setImage(node.id, handle)
    onCleanup(() => {
      if (node) getOps().setImage(node.id, -1)
      handle = -1
      texture.release()
    })
  })
  const bind = (value: NodeMirror | null) => {
    node = value
    if (node) getOps().setImage(node.id, handle)
  }
  return <Image class="absolute" nodeRef={bind} style={statusIconTextureBounds(props.width, props.height)} />
}
