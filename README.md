
#TODO


##Це
- endiannes
- WCHAR_RE to unicode
- TextEncoder in node?, check http://jsperf.com/nativeencodevsmanual
- exceptions in generators and stuff, why not propagated?
- read on nodejs-browser compartiple code writing
- xml traversing to generators
- uglify es6
- short circuit stream slicer
- traverseDocumentOrder onleave
- backup server
- isTTY
- tag name namespaces
- xpath thing
- gulp sound
- etag
- when variable clashes with keyword how to name it?
- ask to bump minor version when https://github.com/kmike/DAWG/issues/21 gets fixed
- parentNode to parentElement
- lang setter
- ana attr change to meaningful
- test codec like https://github.com/mathiasbynens/utf8.js/blob/master/tests/tests.js
- wstorm code review
- continuation indent
- key encoder: no zero bytes


- скорочення
- <supplied>
- ввічлива форма — смислове уоднозначнення


brew install node --with-full-icu
ext install tslint
ext install EditorConfig

compilecorp --recompile-corpus --no-sketches --no-biterms corpik

### tslint todo
- param alingment
- no-empty, but how about constructors?
- unused variable when needs to export, like in business.node.ts https://github.com/palantir/tslint/issues/1157
- custom rules
- share config among projects
- typedef
- no-function-expression
- no-conditional-assignment?
- recheck new falses
- expected a 'break' before 'case' bug
- wait for better https://github.com/buzinas/tslint-eslint-rules
- wrap conditional assignments
- one-variable-per-declaration

### http://standardjs.com/rules.html
- function name (arg) { ... }
- keep else statements on the same line as their curly braces.
- multiple blank lines not allowed.


- Style 02-07
- Do use uppercase with underscores when naming constants.
- Consider naming an interface without an I prefix.
- tslint rules for the Styleguide?
- Import Line Spacing, Style 03-06

### not reused among projects
- utf8 encode/decode
- wrappedOrNull
- mixin
- countGenerated
- ithGenerated