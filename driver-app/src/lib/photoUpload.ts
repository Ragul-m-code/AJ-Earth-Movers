import { File } from "expo-file-system";

/** Native: the camera's file URI becomes an expo-file-system File, which implements Blob for FormData. */
export async function appendPhoto(form: FormData, uri: string) {
  form.append("photo", new File(uri) as unknown as Blob, "meter.jpg");
}
