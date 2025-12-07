import warnings
import click


@click.command('fetch', short_help='[DEPRECATED] Download required binaries.')
@click.option(
    '--force',
    is_flag=True,
    help='(Deprecated) This option is no longer needed.',
)
def cli(force: bool) -> None:
    """[DEPRECATED] This command is no longer needed.

    As of version 0.13.0, Prisma Client Python uses a TypeScript bridge service
    instead of Rust binaries. The bridge service is distributed via npm and
    does not require downloading platform-specific binaries.

    To set up the bridge service, run:
        cd prisma-bridge && npm install
    """
    click.echo(click.style('DEPRECATED: ', fg='yellow') +
               'The fetch command is no longer needed.')
    click.echo()
    click.echo('As of version 0.13.0, Prisma Client Python uses a TypeScript bridge')
    click.echo('service instead of Rust binaries.')
    click.echo()
    click.echo('To set up the bridge service:')
    click.echo(click.style('  1. ', fg='green') + 'cd prisma-bridge')
    click.echo(click.style('  2. ', fg='green') + 'npm install')
    click.echo(click.style('  3. ', fg='green') + 'npm run dev  # or npm start for production')
    click.echo()
    click.echo('See the documentation for more details:')
    click.echo('  https://github.com/RobertCraigie/prisma-client-py/tree/main/prisma-bridge')
