# Contributing to Capsule

Thank you for your interest in contributing to Capsule! This document provides guidelines and instructions for contributing.

## Development Setup

1. **Prerequisites**
   - Rust (stable) - install via [rustup](https://rustup.rs/)
   - Node.js and pnpm - install Node.js, then run `npm install -g pnpm`
   - Tauri system requirements (see main README)

2. **Clone and Install**
   ```bash
   git clone https://github.com/<your-username>/capsule.git
   cd capsule
   pnpm install
   ```

3. **Run in Development Mode**
   ```bash
   pnpm tauri dev
   ```

## Code Style

### Rust
- Follow standard Rust formatting (use `cargo fmt`)
- Run `cargo clippy` before submitting PRs
- Use meaningful variable and function names
- Add comments for complex logic
- Prefer `Result` types over panicking

### TypeScript
- Use TypeScript strict mode
- Follow existing code style (spaces, semicolons, etc.)
- Use meaningful variable and function names
- Avoid `any` types where possible

### CSS
- Follow existing naming conventions
- Use CSS custom properties (variables) for theming
- Keep selectors specific to avoid conflicts

## Testing

### Before Submitting

1. **Run Tests**
   ```bash
   cd src-tauri
   cargo test
   ```

2. **Type Check TypeScript**
   ```bash
   pnpm build
   ```

3. **Test Manually**
   - Test the feature/fix in the development build
   - Test with different archive formats
   - Test error cases (corrupted archives, invalid paths, etc.)

## Submitting Changes

1. **Create a Branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-fix-name
   ```

2. **Make Changes**
   - Write clear, focused commits
   - Follow the existing code style
   - Update documentation if needed

3. **Test Your Changes**
   - Run tests and type checking
   - Test manually in the app

4. **Commit**
   ```bash
   git commit -m "feat: add your feature description"
   # or
   git commit -m "fix: fix issue description"
   ```

   Use conventional commit messages:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation changes
   - `refactor:` for code refactoring
   - `test:` for test additions/changes
   - `chore:` for maintenance tasks

5. **Push and Create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

   Then create a pull request on GitHub.

## Pull Request Guidelines

- **Keep PRs focused** - One feature or fix per PR
- **Write clear descriptions** - Explain what the PR does and why
- **Link related issues** - Use "Fixes #123" or "Closes #123" in the description
- **Add tests** - Include tests for new features when possible
- **Update documentation** - Update README, CHANGELOG, or other docs if needed

## Areas for Contribution

- Bug fixes
- New archive format support
- Performance improvements (especially for large archives)
- UI/UX improvements
- Documentation improvements
- Test coverage
- macOS/Linux build support

## Questions?

Feel free to open an issue for discussion before starting work on a large feature.


