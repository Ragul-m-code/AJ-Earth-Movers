/** Web: the camera returns a base64 data URI; convert it to a Blob for the multipart body. */
export async function appendPhoto(form: FormData, uri: string) {
  const blob = await (await fetch(uri)).blob();
  form.append("photo", blob, "meter.jpg");
}
