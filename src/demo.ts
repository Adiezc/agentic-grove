/**
 * Demo mode: the concept art's six stones and a full tree of example agents.
 *
 * Off by default, everywhere, including the app people will download. A real grove starts empty
 * and fills with the projects you choose. The demo exists for one reason: to judge the scene
 * against the art in a plain browser tab, which has no scan and so could never show a real one.
 * Open the dev preview with `?demo` on the end of the address.
 */
export const DEMO = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo')
