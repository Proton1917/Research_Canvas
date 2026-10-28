import {
  type MarkdownAdapterPreprocessor,
  MarkdownPreprocessorExtension,
} from '@editor/shared/adapters';
import { isValidUrl } from '@editor/shared/utils';

const codePreprocessor: MarkdownAdapterPreprocessor = {
  name: 'code',
  levels: ['slice'],
  preprocess: content => {
    let codeFence = '';
    const lines = content
      .split('\n')
      .map(line => {
        if (line.trimStart().startsWith('-')) {
          return line;
        }
        let trimmedLine = line.trimStart();
        if (!codeFence && trimmedLine.startsWith('```')) {
          codeFence = trimmedLine.substring(
            0,
            trimmedLine.lastIndexOf('```') + 3
          );
          if (codeFence.split('').every(c => c === '`')) {
            return line;
          }
          codeFence = '';
        }
        if (!codeFence && trimmedLine.startsWith('~~~')) {
          codeFence = trimmedLine.substring(
            0,
            trimmedLine.lastIndexOf('~~~') + 3
          );
          if (codeFence.split('').every(c => c === '~')) {
            return line;
          }
          codeFence = '';
        }
        if (
          !!codeFence &&
          trimmedLine.startsWith(codeFence) &&
          trimmedLine.lastIndexOf(codeFence) === 0
        ) {
          codeFence = '';
        }
        if (codeFence) {
          return line;
        }

        trimmedLine = trimmedLine.trimEnd();
        if (
          !trimmedLine.startsWith('<') &&
          !trimmedLine.endsWith('>') &&
          !trimmedLine.includes(' ')
        ) {
          // check if it is a url link and wrap it with the angle brackets
          // sometimes the url includes emphasis `_` that will break URL parsing
          //
          // eg. /MuawcBMT1Mzvoar09-_66?mode=page&blockIds=rL2_GXbtLU2SsJVfCSmh_
          // https://www.markdownguide.org/basic-syntax/#urls-and-email-addresses
          // An angle-bracket autolink requires a scheme; wrapping a relative
          // path such as `docs/a_b.md` would render the brackets literally.
          const valid =
            /^[a-zA-Z][a-zA-Z0-9+.-]{1,31}:/.test(trimmedLine) &&
            isValidUrl(trimmedLine);
          if (valid) {
            return `<${trimmedLine}>`;
          }
        }

        return line.replace(/^ /, '&#x20;');
      })
      .join('\n');

    return lines;
  },
};

export const CodeMarkdownPreprocessorExtension =
  MarkdownPreprocessorExtension(codePreprocessor);
