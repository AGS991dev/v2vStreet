-- RadioMap / SQL Server
-- El GPS en vivo NO va acá. Acá: perfiles, grupos, encuentros y bloqueos.

IF OBJECT_ID('dbo.usuarios', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.usuarios (
        id NVARCHAR(64) NOT NULL PRIMARY KEY,
        nombre NVARCHAR(40) NOT NULL CONSTRAINT DF_usuarios_nombre DEFAULT (''),
        vehiculo NVARCHAR(40) NOT NULL CONSTRAINT DF_usuarios_vehiculo DEFAULT (''),
        iconoX INT NOT NULL CONSTRAINT DF_usuarios_iconoX DEFAULT (0),
        iconoY INT NOT NULL CONSTRAINT DF_usuarios_iconoY DEFAULT (0),
        placa NVARCHAR(20) NULL,
        seguro NVARCHAR(40) NULL,
        contacto NVARCHAR(40) NULL,
        creado DATETIME2 NOT NULL CONSTRAINT DF_usuarios_creado DEFAULT (SYSUTCDATETIME()),
        visto DATETIME2 NOT NULL CONSTRAINT DF_usuarios_visto DEFAULT (SYSUTCDATETIME())
    );
END
GO

IF OBJECT_ID('dbo.grupos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.grupos (
        codigo NVARCHAR(8) NOT NULL PRIMARY KEY,
        nombre NVARCHAR(32) NOT NULL,
        creado DATETIME2 NOT NULL CONSTRAINT DF_grupos_creado DEFAULT (SYSUTCDATETIME())
    );
END
GO

IF OBJECT_ID('dbo.grupo_miembros', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.grupo_miembros (
        codigo NVARCHAR(8) NOT NULL,
        usuarioId NVARCHAR(64) NOT NULL,
        nombre NVARCHAR(40) NOT NULL CONSTRAINT DF_grupo_miembros_nombre DEFAULT (''),
        entra DATETIME2 NOT NULL CONSTRAINT DF_grupo_miembros_entra DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_grupo_miembros PRIMARY KEY (codigo, usuarioId),
        CONSTRAINT FK_grupo_miembros_grupo FOREIGN KEY (codigo) REFERENCES dbo.grupos (codigo) ON DELETE CASCADE
    );
    CREATE INDEX IX_grupo_miembros_usuario ON dbo.grupo_miembros (usuarioId);
END
GO

IF OBJECT_ID('dbo.encuentros', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.encuentros (
        id NVARCHAR(40) NOT NULL PRIMARY KEY,
        lat FLOAT NOT NULL,
        lng FLOAT NOT NULL,
        nombre NVARCHAR(80) NOT NULL CONSTRAINT DF_encuentros_nombre DEFAULT (''),
        horario NVARCHAR(40) NULL,
        descripcion NVARCHAR(240) NULL,
        de NVARCHAR(64) NOT NULL,
        grupo NVARCHAR(8) NULL,
        alcance NVARCHAR(16) NOT NULL CONSTRAINT DF_encuentros_alcance DEFAULT ('global'),
        para NVARCHAR(64) NULL,
        ts DATETIME2 NOT NULL CONSTRAINT DF_encuentros_ts DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_encuentros_grupo ON dbo.encuentros (grupo);
    CREATE INDEX IX_encuentros_de ON dbo.encuentros (de);
END
GO

IF OBJECT_ID('dbo.bloqueos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.bloqueos (
        de NVARCHAR(64) NOT NULL,
        contra NVARCHAR(64) NOT NULL,
        ts DATETIME2 NOT NULL CONSTRAINT DF_bloqueos_ts DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_bloqueos PRIMARY KEY (de, contra)
    );
END
GO
